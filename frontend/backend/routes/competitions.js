import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// ─── List competitions (filtered by club) ─────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.description, c.date, c.course_name, c.tee_name,
        c.status, c.created_by, c.created_at, c.format, c.team_size,
        COUNT(DISTINCT e.player_id)::int AS entry_count,
        BOOL_OR(e.player_id = $1)        AS entered,
        c.created_by = $1                AS is_creator,
        EXISTS (
          SELECT 1 FROM club_memberships
          WHERE club_id = c.club_id AND user_id = $1 AND role = 'owner'
        )                                AS is_owner,
        cu.first_name AS creator_first, cu.last_name AS creator_last, cu.email AS creator_email
      FROM competitions c
      LEFT JOIN competition_entries e  ON e.competition_id = c.id
      LEFT JOIN users cu               ON cu.id = c.created_by
      WHERE ($2::int IS NULL OR c.club_id = $2)
      GROUP BY c.id, cu.first_name, cu.last_name, cu.email
      ORDER BY
        CASE c.status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
        c.date DESC
    `, [req.userId, clubId]);
    res.json(result.rows);
  } catch (err) {
    console.error('List competitions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create competition ───────────────────────────────────────────────────────

const VALID_FORMATS = ['stableford', 'stroke', 'net_stroke', 'match_play', 'scramble', 'best_ball', 'skins'];

router.post('/', requireAuth, async (req, res) => {
  const { name, description, date, courseName, teeName, holeData, clubId, format, teamSize, groupId } = req.body;
  if (!name?.trim() || !date || !courseName?.trim()) {
    return res.status(400).json({ error: 'Name, date and course are required' });
  }
  const fmt = VALID_FORMATS.includes(format) ? format : 'stableford';
  const ts  = ['scramble', 'best_ball'].includes(fmt) ? Math.max(2, Math.min(4, parseInt(teamSize) || 2)) : 1;
  const joinCode = !clubId ? generateJoinCode() : null;
  try {
    const result = await pool.query(`
      INSERT INTO competitions (name, description, date, course_name, tee_name, hole_data, created_by, club_id, format, team_size, join_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name.trim(),
      description?.trim() || null,
      date,
      courseName.trim(),
      teeName || null,
      holeData ? JSON.stringify(holeData) : null,
      req.userId,
      clubId || null,
      fmt,
      ts,
      joinCode,
    ]);
    const comp = result.rows[0];
    if (groupId) {
      await pool.query(
        `INSERT INTO competition_group_members (group_id, competition_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [parseInt(groupId), comp.id]
      );
    }
    res.status(201).json(comp);
  } catch (err) {
    console.error('Create competition error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── My standalone competitions (no club) ────────────────────────────────────

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.date, c.course_name, c.status, c.format, c.join_code,
        COUNT(DISTINCT e.player_id)::int AS entry_count,
        BOOL_OR(e.player_id = $1)        AS entered,
        c.created_by = $1                AS is_creator
      FROM competitions c
      LEFT JOIN competition_entries e ON e.competition_id = c.id
      WHERE c.club_id IS NULL
        AND (c.created_by = $1 OR EXISTS (
          SELECT 1 FROM competition_entries ce WHERE ce.competition_id = c.id AND ce.player_id = $1
        ))
      GROUP BY c.id
      ORDER BY
        CASE c.status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
        c.date DESC
      LIMIT 10
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('My competitions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Join competition by code ─────────────────────────────────────────────────

router.post('/join', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: 'code is required' });
  try {
    const compRes = await pool.query(
      `SELECT id, status, name FROM competitions WHERE UPPER(join_code) = UPPER($1)`,
      [code.trim()]
    );
    if (!compRes.rows.length) return res.status(404).json({ error: 'No tournament found with that code' });
    const comp = compRes.rows[0];
    if (comp.status === 'completed') {
      return res.status(400).json({ error: 'This tournament is already completed' });
    }
    await pool.query(
      `INSERT INTO competition_entries (competition_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [comp.id, req.userId]
    );
    res.json({ competitionId: comp.id, name: comp.name });
  } catch (err) {
    console.error('Join by code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Get competition detail ───────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const compRes = await pool.query(`
      SELECT c.*,
        cu.first_name AS creator_first, cu.last_name AS creator_last, cu.email AS creator_email
      FROM competitions c
      LEFT JOIN users cu ON cu.id = c.created_by
      WHERE c.id = $1
    `, [req.params.id]);
    if (!compRes.rows.length) return res.status(404).json({ error: 'Competition not found' });
    const comp = compRes.rows[0];

    const entriesRes = await pool.query(`
      SELECT
        e.id, e.player_id, e.scorer_id, e.team_id, e.created_at,
        p.first_name AS player_first, p.last_name AS player_last,
        p.email AS player_email, p.is_guest,
        COALESCE(e.handicap, p.handicap) AS handicap,
        e.handicap AS handicap_override, p.handicap AS profile_handicap,
        s.first_name AS scorer_first, s.last_name AS scorer_last, s.email AS scorer_email,
        COALESCE(SUM(cs.stableford_points), 0)::int AS total_stableford,
        COALESCE(SUM(cs.score),            0)::int AS total_strokes,
        COUNT(cs.hole_number)::int                  AS holes_played
      FROM competition_entries e
      JOIN  users p  ON p.id = e.player_id
      LEFT JOIN users s  ON s.id = e.scorer_id
      LEFT JOIN (
        SELECT competition_id, player_id, hole_number,
          COALESCE(
            MAX(CASE WHEN submitted_by != player_id THEN score END),
            MAX(CASE WHEN submitted_by  = player_id THEN score END)
          ) AS score,
          COALESCE(
            MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
            MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
          ) AS stableford_points
        FROM competition_scores
        GROUP BY competition_id, player_id, hole_number
      ) cs ON cs.competition_id = e.competition_id AND cs.player_id = e.player_id
      WHERE e.competition_id = $1
      GROUP BY e.id, e.player_id, e.scorer_id, e.team_id, e.created_at,
               p.first_name, p.last_name, p.email, p.handicap, p.is_guest,
               s.first_name, s.last_name, s.email
      ORDER BY total_stableford DESC, holes_played DESC
    `, [req.params.id]);

    const entries    = entriesRes.rows;
    const myEntry    = entries.find(e => e.player_id  === req.userId) ?? null;
    const scoringFor = entries.find(e => e.scorer_id  === req.userId) ?? null;

    // Dual scorecard: each player scores themselves AND their marker scores them.
    // partnerScorecard — current user's marker submissions for their partner + partner's self-scores
    // myScorecard      — current user's self-scores + their marker's submissions for them
    let partnerScorecard = null;
    if (scoringFor) {
      const [markerRes, selfRes] = await Promise.all([
        pool.query(`
          SELECT hole_number, score, stableford_points
          FROM competition_scores
          WHERE competition_id = $1 AND player_id = $2 AND submitted_by = $3
          ORDER BY hole_number
        `, [req.params.id, scoringFor.player_id, req.userId]),
        pool.query(`
          SELECT hole_number, score, stableford_points
          FROM competition_scores
          WHERE competition_id = $1 AND player_id = $2 AND submitted_by = $2
          ORDER BY hole_number
        `, [req.params.id, scoringFor.player_id]),
      ]);
      partnerScorecard = { markerScores: markerRes.rows, selfScores: selfRes.rows };
    }

    let myScorecard = null;
    if (myEntry) {
      const [selfRes, markerRes] = await Promise.all([
        pool.query(`
          SELECT hole_number, score, stableford_points
          FROM competition_scores
          WHERE competition_id = $1 AND player_id = $2 AND submitted_by = $2
          ORDER BY hole_number
        `, [req.params.id, req.userId]),
        myEntry.scorer_id ? pool.query(`
          SELECT hole_number, score, stableford_points
          FROM competition_scores
          WHERE competition_id = $1 AND player_id = $2 AND submitted_by = $3
          ORDER BY hole_number
        `, [req.params.id, req.userId, myEntry.scorer_id]) : Promise.resolve({ rows: [] }),
      ]);
      myScorecard = { selfScores: selfRes.rows, markerScores: markerRes.rows };
    }

    let isOwner = false;
    if (comp.club_id) {
      const { rows: [m] } = await pool.query(
        'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
        [comp.club_id, req.userId]
      );
      isOwner = m?.role === 'owner';
    }

    res.json({
      ...comp,
      entries,
      myEntry,
      scoringFor,
      partnerScorecard,
      myScorecard,
      isCreator: comp.created_by === req.userId,
      isOwner,
    });
  } catch (err) {
    console.error('Get competition error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Delete competition (any authenticated user) ──────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM competitions WHERE id = $1',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete competition error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Update status (creator only) ────────────────────────────────────────────

router.patch('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['active', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    // Verify creator and capture the current status before updating
    const checkRes = await pool.query(
      'SELECT * FROM competitions WHERE id = $1 AND created_by = $2',
      [req.params.id, req.userId]
    );
    if (!checkRes.rows.length) return res.status(403).json({ error: 'Not authorised' });
    const wasAlreadyCompleted = checkRes.rows[0].status === 'completed';

    const result = await pool.query(
      `UPDATE competitions SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    const comp = result.rows[0];

    // Auto-log a round for every player when the competition is first completed.
    // Idempotent — skipped if already completed before this call.
    if (status === 'completed' && !wasAlreadyCompleted) {
      try {
        // Build a hole-info map from competition hole_data (par + stroke_index per hole)
        const holeInfoArr = Array.isArray(comp.hole_data) ? comp.hole_data : null;
        const holeMap = new Map((holeInfoArr || []).map(h => [h.number, h]));

        // Resolve final per-hole scores for every player using dual-scoring priority
        // (marker submission beats player self-score)
        const allHolesRes = await pool.query(`
          SELECT
            player_id,
            hole_number,
            COALESCE(
              MAX(CASE WHEN submitted_by != player_id THEN score END),
              MAX(CASE WHEN submitted_by  = player_id THEN score END)
            )::int AS score,
            COALESCE(
              MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
              MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
            )::int AS stableford_points,
            -- fairway_hit: prefer marker, fall back to self
            COALESCE(
              MAX(CASE WHEN submitted_by != player_id THEN fairway_hit::int END),
              MAX(CASE WHEN submitted_by  = player_id THEN fairway_hit::int END)
            ) AS fairway_hit_int,
            COALESCE(
              MAX(CASE WHEN submitted_by != player_id THEN gir::int END),
              MAX(CASE WHEN submitted_by  = player_id THEN gir::int END)
            ) AS gir_int,
            COALESCE(
              MAX(CASE WHEN submitted_by != player_id THEN putts END),
              MAX(CASE WHEN submitted_by  = player_id THEN putts END)
            ) AS putts
          FROM competition_scores
          WHERE competition_id = $1
          GROUP BY player_id, hole_number
          ORDER BY player_id, hole_number
        `, [req.params.id]);

        // Group resolved holes by player_id
        const holesByPlayer = new Map();
        for (const h of allHolesRes.rows) {
          if (!holesByPlayer.has(h.player_id)) holesByPlayer.set(h.player_id, []);
          holesByPlayer.get(h.player_id).push(h);
        }

        // Resolve totals per player
        const scoresRes = await pool.query(`
          SELECT
            e.player_id,
            COALESCE(SUM(cs.score),            0)::int AS total_strokes,
            COALESCE(SUM(cs.stableford_points), 0)::int AS total_stableford,
            COUNT(cs.hole_number)::int                  AS holes_played
          FROM competition_entries e
          LEFT JOIN (
            SELECT competition_id, player_id, hole_number,
              COALESCE(
                MAX(CASE WHEN submitted_by != player_id THEN score END),
                MAX(CASE WHEN submitted_by  = player_id THEN score END)
              ) AS score,
              COALESCE(
                MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
                MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
              ) AS stableford_points
            FROM competition_scores
            GROUP BY competition_id, player_id, hole_number
          ) cs ON cs.competition_id = e.competition_id AND cs.player_id = e.player_id
          WHERE e.competition_id = $1
          GROUP BY e.player_id
          HAVING COUNT(cs.hole_number) > 0
        `, [req.params.id]);

        for (const row of scoresRes.rows) {
          try {
            // Insert round, returning the id so we can attach round_holes
            const insResult = await pool.query(`
              INSERT INTO rounds (user_id, played_at, course_name, score, stableford, notes, competition_id, status)
              SELECT $1, $2, $3, $4, $5, $6, $7, 'completed'
              WHERE NOT EXISTS (
                SELECT 1 FROM rounds WHERE user_id = $1 AND competition_id = $7
              )
              RETURNING id
            `, [
              row.player_id,
              comp.date,
              comp.course_name,
              row.total_strokes,
              row.total_stableford,
              `Tournament: ${comp.name}`,
              comp.id,
            ]);

            // Resolve the round id (newly inserted or pre-existing)
            let roundId;
            if (insResult.rows.length > 0) {
              roundId = insResult.rows[0].id;
            } else {
              const existRes = await pool.query(
                `SELECT id FROM rounds WHERE user_id = $1 AND competition_id = $2`,
                [row.player_id, comp.id]
              );
              roundId = existRes.rows[0]?.id;
            }

            // Copy per-hole data to round_holes so Hall / stats queries work
            if (roundId) {
              const { rows: [{ count }] } = await pool.query(
                `SELECT COUNT(*)::int AS count FROM round_holes WHERE round_id = $1`,
                [roundId]
              );
              if (count === 0) {
                const playerHoles = holesByPlayer.get(row.player_id) || [];
                for (const h of playerHoles) {
                  const hInfo = holeMap.get(h.hole_number);
                  const fairwayHit = h.fairway_hit_int != null ? h.fairway_hit_int === 1 : null;
                  const gir        = h.gir_int        != null ? h.gir_int        === 1 : null;
                  await pool.query(`
                    INSERT INTO round_holes
                      (round_id, hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (round_id, hole_number) DO NOTHING
                  `, [
                    roundId,
                    h.hole_number,
                    hInfo?.par ?? 4,
                    hInfo?.si  ?? h.hole_number,
                    h.score,
                    h.stableford_points,
                    fairwayHit,
                    gir,
                    h.putts ?? null,
                  ]);
                }
              }
            }
          } catch (playerErr) {
            console.error(`Auto-log error for player ${row.player_id}:`, playerErr);
            // best-effort — don't block other players
          }
        }
      } catch (logErr) {
        console.error('Auto-log rounds error:', logErr);
        // Don't fail the status update if round logging errors
      }
    }

    res.json(comp);
  } catch (err) {
    console.error('Update status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Enter competition ────────────────────────────────────────────────────────

router.post('/:id/enter', requireAuth, async (req, res) => {
  try {
    const comp = await pool.query('SELECT status FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].status !== 'upcoming') {
      return res.status(400).json({ error: 'Competition is not open for entries' });
    }
    const result = await pool.query(
      `INSERT INTO competition_entries (competition_id, player_id) VALUES ($1, $2) RETURNING *`,
      [req.params.id, req.userId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Already entered' });
    console.error('Enter error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Withdraw from competition ────────────────────────────────────────────────

router.delete('/:id/enter', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM competition_entries WHERE competition_id = $1 AND player_id = $2`,
      [req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Withdraw error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Add players (creator only) ───────────────────────────────────────────────
// Lets the tournament creator enter players directly — club members (with an
// optional per-tournament handicap override) or guests with no account at all.
// Guests get a real, unusable `users` row (is_guest = true, random credentials)
// so every existing entries/scores/leaderboard query keeps working unchanged
// rather than needing a nullable-player_id branch threaded through all of them.

router.post('/:id/entries', requireAuth, async (req, res) => {
  const { players } = req.body;
  if (!Array.isArray(players) || !players.length) {
    return res.status(400).json({ error: 'players array required' });
  }

  const client = await pool.connect();
  try {
    const comp = await client.query('SELECT created_by, status FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    await client.query('BEGIN');

    const added = [];
    for (const p of players) {
      const handicap = p?.handicap != null && p.handicap !== '' ? parseFloat(p.handicap) : null;
      if (handicap != null && (isNaN(handicap) || handicap < -10 || handicap > 54)) {
        throw Object.assign(new Error('Handicap must be between -10 and 54'), { status: 400 });
      }

      let playerId = p?.userId || null;

      if (!playerId) {
        const guestName = (p?.guestName || '').trim();
        if (!guestName) continue; // neither a userId nor a guest name — skip silently
        const [firstName, ...rest] = guestName.split(/\s+/);
        const lastName = rest.join(' ') || null;
        const guestEmail = `guest+${randomUUID()}@fairwayiq.invalid`;
        const guestHash  = await bcrypt.hash(randomUUID(), 10);
        const { rows: [guest] } = await client.query(`
          INSERT INTO users (email, password_hash, first_name, last_name, is_guest)
          VALUES ($1, $2, $3, $4, TRUE)
          RETURNING id
        `, [guestEmail, guestHash, firstName, lastName]);
        playerId = guest.id;
      }

      const { rows: [entry] } = await client.query(`
        INSERT INTO competition_entries (competition_id, player_id, handicap)
        VALUES ($1, $2, $3)
        ON CONFLICT (competition_id, player_id) DO UPDATE SET handicap = $3
        RETURNING id, player_id, handicap
      `, [req.params.id, playerId, handicap]);
      added.push(entry);
    }

    await client.query('COMMIT');
    res.status(201).json({ added });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Add players error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Update a player's tournament handicap (creator only) ────────────────────

router.patch('/:id/entries/:entryId', requireAuth, async (req, res) => {
  const { handicap } = req.body;
  const hcp = handicap != null && handicap !== '' ? parseFloat(handicap) : null;
  if (hcp != null && (isNaN(hcp) || hcp < -10 || hcp > 54)) {
    return res.status(400).json({ error: 'Handicap must be between -10 and 54' });
  }
  try {
    const comp = await pool.query('SELECT created_by FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });

    const { rows } = await pool.query(
      `UPDATE competition_entries SET handicap = $1 WHERE id = $2 AND competition_id = $3 RETURNING id, player_id, handicap`,
      [hcp, req.params.entryId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update entry handicap error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Remove a player the creator added (creator only) ─────────────────────────

router.delete('/:id/entries/:entryId', requireAuth, async (req, res) => {
  try {
    const comp = await pool.query('SELECT created_by FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });

    const { rows } = await pool.query(
      `DELETE FROM competition_entries WHERE id = $1 AND competition_id = $2 RETURNING id`,
      [req.params.entryId, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Entry not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Remove entry error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Set scoring pairs (creator only) ────────────────────────────────────────

router.patch('/:id/pairs', requireAuth, async (req, res) => {
  const { pairs } = req.body;
  if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs must be an array' });
  if (pairs.some(p => p?.playerId && p.playerId === p.scorerId)) {
    return res.status(400).json({ error: 'A player cannot be their own scorer' });
  }

  try {
    const comp = await pool.query('SELECT created_by, status FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    const { rows: entered } = await pool.query(
      'SELECT player_id FROM competition_entries WHERE competition_id = $1',
      [req.params.id]
    );
    const enteredIds = new Set(entered.map(e => e.player_id));
    for (const { playerId, scorerId } of pairs) {
      if (!enteredIds.has(playerId) || (scorerId != null && !enteredIds.has(scorerId))) {
        return res.status(400).json({ error: 'playerId and scorerId must both be entered in this competition' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { playerId, scorerId } of pairs) {
        await client.query(
          `UPDATE competition_entries SET scorer_id = $1
           WHERE competition_id = $2 AND player_id = $3`,
          [scorerId ?? null, req.params.id, playerId]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Set pairs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Set best-ball teams (creator only) ───────────────────────────────────────
// Groups of 2-4 entered players. Unlike /pairs (a marker relationship), this is
// what the leaderboard groups on for best_ball: the whole team's best stableford
// score per hole counts, and any teammate can submit scores for any other.

router.post('/:id/teams', requireAuth, async (req, res) => {
  const { teams } = req.body;
  if (!Array.isArray(teams) || !teams.length) {
    return res.status(400).json({ error: 'teams array required' });
  }

  try {
    const comp = await pool.query('SELECT created_by, status, format, team_size FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });
    if (comp.rows[0].format !== 'best_ball') return res.status(400).json({ error: 'Teams only apply to best ball competitions' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    const { rows: entered } = await pool.query(
      'SELECT player_id FROM competition_entries WHERE competition_id = $1',
      [req.params.id]
    );
    const enteredIds = new Set(entered.map(e => e.player_id));

    for (const team of teams) {
      if (!Array.isArray(team) || team.length < 2 || team.length > comp.rows[0].team_size) {
        return res.status(400).json({ error: `Each team must have 2-${comp.rows[0].team_size} players` });
      }
      if (team.some(id => !enteredIds.has(id))) {
        return res.status(400).json({ error: 'All team members must be entered in this competition' });
      }
      if (new Set(team).size !== team.length) {
        return res.status(400).json({ error: 'A team cannot include the same player twice' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const team of teams) {
        const teamId = Math.floor(Math.random() * 1e9);
        await client.query(
          `UPDATE competition_entries SET team_id = $1 WHERE competition_id = $2 AND player_id = ANY($3::uuid[])`,
          [teamId, req.params.id, team]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Set teams error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Self-service: join a teammate's best-ball team ───────────────────────────
// Mirrors /partner but for team_id rather than scorer_id, and grows a group up
// to team_size rather than strictly pairing two people.

router.post('/:id/team', requireAuth, async (req, res) => {
  const { teammateId } = req.body;
  if (!teammateId) return res.status(400).json({ error: 'teammateId required' });
  if (teammateId === req.userId) return res.status(400).json({ error: 'Cannot team up with yourself' });

  try {
    const comp = await pool.query('SELECT status, format, team_size FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].format !== 'best_ball') return res.status(400).json({ error: 'Teams only apply to best ball competitions' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    const [myRow, mateRow] = await Promise.all([
      pool.query('SELECT team_id FROM competition_entries WHERE competition_id = $1 AND player_id = $2', [req.params.id, req.userId]),
      pool.query('SELECT team_id FROM competition_entries WHERE competition_id = $1 AND player_id = $2', [req.params.id, teammateId]),
    ]);
    if (!myRow.rows.length)   return res.status(403).json({ error: 'You are not entered in this competition' });
    if (!mateRow.rows.length) return res.status(400).json({ error: 'That player is not entered in this competition' });

    // Join the teammate's existing team if they have one, otherwise start a new one together.
    let teamId = mateRow.rows[0].team_id;
    if (teamId == null) {
      teamId = Math.floor(Math.random() * 1e9);
    } else {
      const { rows: [{ count }] } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM competition_entries WHERE competition_id = $1 AND team_id = $2`,
        [req.params.id, teamId]
      );
      if (count >= comp.rows[0].team_size) {
        return res.status(400).json({ error: 'That team is already full' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE competition_entries SET team_id = $1 WHERE competition_id = $2 AND player_id = $3`,
        [teamId, req.params.id, teammateId]
      );
      await client.query(
        `UPDATE competition_entries SET team_id = $1 WHERE competition_id = $2 AND player_id = $3`,
        [teamId, req.params.id, req.userId]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Join team error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Self-service partner pairing ────────────────────────────────────────────
// Any entered player can call this to set a bidirectional scoring pair.

router.post('/:id/partner', requireAuth, async (req, res) => {
  const { partnerId } = req.body;
  if (!partnerId) return res.status(400).json({ error: 'partnerId required' });
  if (partnerId === req.userId) return res.status(400).json({ error: 'Cannot pair with yourself' });

  try {
    const compRes = await pool.query('SELECT status FROM competitions WHERE id = $1', [req.params.id]);
    if (!compRes.rows.length) return res.status(404).json({ error: 'Not found' });
    if (compRes.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    const [myRow, partnerRow] = await Promise.all([
      pool.query('SELECT player_id FROM competition_entries WHERE competition_id = $1 AND player_id = $2', [req.params.id, req.userId]),
      pool.query('SELECT player_id FROM competition_entries WHERE competition_id = $1 AND player_id = $2', [req.params.id, partnerId]),
    ]);
    if (!myRow.rows.length)      return res.status(403).json({ error: 'You are not entered in this competition' });
    if (!partnerRow.rows.length) return res.status(400).json({ error: 'That player is not entered in this competition' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE competition_entries SET scorer_id = $1 WHERE competition_id = $2 AND player_id = $3',
        [req.userId, req.params.id, partnerId]
      );
      await client.query(
        'UPDATE competition_entries SET scorer_id = $1 WHERE competition_id = $2 AND player_id = $3',
        [partnerId, req.params.id, req.userId]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Set partner error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Submit / update a hole score ────────────────────────────────────────────

router.post('/:id/scores', requireAuth, async (req, res) => {
  const { playerId, holeNumber, score, stablefordPoints, fairwayHit, gir, putts } = req.body;
  if (!playerId || !holeNumber || score == null || stablefordPoints == null) {
    return res.status(400).json({ error: 'playerId, holeNumber, score and stablefordPoints required' });
  }
  try {
    const comp = await pool.query('SELECT status, format FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    // Auto-activate upcoming competition when first score arrives
    if (comp.rows[0].status === 'upcoming') {
      await pool.query(`UPDATE competitions SET status = 'active' WHERE id = $1`, [req.params.id]);
    }

    const entry = await pool.query(
      `SELECT scorer_id, player_id, team_id FROM competition_entries
       WHERE competition_id = $1 AND player_id = $2`,
      [req.params.id, playerId]
    );
    if (!entry.rows.length) return res.status(404).json({ error: 'Player not in competition' });
    const isSelf = playerId === req.userId;
    const isAssignedScorer = entry.rows[0].scorer_id === req.userId;

    // Best ball: team membership grants scoring rights for any teammate — there's
    // no single pairwise marker once a team can have 3-4 players.
    let isTeammate = false;
    if (!isSelf && !isAssignedScorer && comp.rows[0].format === 'best_ball' && entry.rows[0].team_id != null) {
      const { rows: mine } = await pool.query(
        `SELECT 1 FROM competition_entries WHERE competition_id = $1 AND player_id = $2 AND team_id = $3`,
        [req.params.id, req.userId, entry.rows[0].team_id]
      );
      isTeammate = mine.length > 0;
    }

    if (!isSelf && !isAssignedScorer && !isTeammate) {
      return res.status(403).json({ error: 'You are not the assigned scorer for this player' });
    }

    await pool.query(`
      INSERT INTO competition_scores
        (competition_id, player_id, hole_number, score, stableford_points, submitted_by, fairway_hit, gir, putts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (competition_id, player_id, hole_number, submitted_by) DO UPDATE
        SET score = $4, stableford_points = $5, updated_at = NOW(),
            fairway_hit = $7, gir = $8, putts = $9
    `, [req.params.id, playerId, holeNumber, score, stablefordPoints, req.userId,
        fairwayHit ?? null, gir ?? null, putts ?? null]);

    res.json({ ok: true });

    // Broadcast updated leaderboard to all live watchers (fire-and-forget)
    computeLeaderboard(req.params.id).then(lb => {
      if (!lb) return;
      getIo()?.to(`competition:${req.params.id}`).emit('competition_score', {
        competitionId: Number(req.params.id),
        ...lb,
      });
    }).catch(() => {});
  } catch (err) {
    console.error('Submit score error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Leaderboard helper (used by GET endpoint and score broadcast) ────────────

// Best ball: the leaderboard ranks teams, not individuals — each hole's team score
// is the best (max) stableford among teammates who have a score for that hole.
// Players without a team yet show as a solo "team" of one so they still appear.
async function computeBestBallLeaderboard(competitionId) {
  const [entriesRes, holeRes] = await Promise.all([
    pool.query(`
      SELECT e.player_id AS id, e.team_id,
        p.first_name, p.last_name, p.email, p.is_guest,
        COALESCE(e.handicap, p.handicap) AS handicap
      FROM competition_entries e
      JOIN users p ON p.id = e.player_id
      WHERE e.competition_id = $1
    `, [competitionId]),
    pool.query(`
      SELECT player_id, hole_number,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN score END),
          MAX(CASE WHEN submitted_by  = player_id THEN score END)
        ) AS score,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
          MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
        ) AS stableford_points
      FROM competition_scores
      WHERE competition_id = $1
      GROUP BY player_id, hole_number
    `, [competitionId]),
  ]);

  const holesByPlayer = {};
  for (const row of holeRes.rows) {
    (holesByPlayer[row.player_id] ??= []).push(row);
  }

  const teams = new Map();
  for (const e of entriesRes.rows) {
    const key = e.team_id != null ? `team:${e.team_id}` : `solo:${e.id}`;
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(e);
  }

  const rows = [];
  for (const [key, members] of teams) {
    const isTeam = members.length > 1;

    const byHole = {};
    for (const m of members) {
      for (const h of (holesByPlayer[m.id] || [])) {
        if (h.stableford_points == null) continue;
        const best = byHole[h.hole_number];
        if (!best || h.stableford_points > best.stableford_points) {
          byHole[h.hole_number] = { hole_number: h.hole_number, score: h.score, stableford_points: h.stableford_points };
        }
      }
    }
    const hole_scores = Object.values(byHole).sort((a, b) => a.hole_number - b.hole_number);
    const total_stableford = hole_scores.reduce((s, h) => s + h.stableford_points, 0);
    const total_strokes    = hole_scores.reduce((s, h) => s + (h.score ?? 0), 0);

    const primary = members[0];
    rows.push({
      id: isTeam ? key : primary.id,
      member_ids: members.map(m => m.id),
      first_name: isTeam
        ? members.map(m => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email).join(' & ')
        : primary.first_name,
      last_name: isTeam ? null : primary.last_name,
      email: primary.email,
      is_guest: isTeam ? false : primary.is_guest,
      handicap: isTeam ? null : primary.handicap,
      total_stableford,
      total_strokes,
      net_strokes: total_strokes,
      holes_played: hole_scores.length,
      hole_scores,
    });
  }

  rows.sort((a, b) => b.total_stableford - a.total_stableford || b.holes_played - a.holes_played);
  return { format: 'best_ball', rows };
}

async function computeLeaderboard(competitionId) {
  const compRes = await pool.query('SELECT format FROM competitions WHERE id = $1', [competitionId]);
  if (!compRes.rows.length) return null;
  const { format } = compRes.rows[0];

  if (format === 'best_ball') return computeBestBallLeaderboard(competitionId);

  const [result, holeRes] = await Promise.all([
    pool.query(`
      SELECT
        p.id, p.first_name, p.last_name, p.email, p.is_guest,
        COALESCE(e.handicap, p.handicap) AS handicap,
        COALESCE(SUM(cs.stableford_points), 0)::int AS total_stableford,
        COALESCE(SUM(cs.score),            0)::int AS total_strokes,
        COUNT(cs.hole_number)::int                  AS holes_played,
        (COALESCE(SUM(cs.score), 0) - FLOOR(COALESCE(e.handicap, p.handicap, 0)))::int AS net_strokes
      FROM competition_entries e
      JOIN  users p  ON p.id = e.player_id
      LEFT JOIN (
        SELECT competition_id, player_id, hole_number,
          COALESCE(
            MAX(CASE WHEN submitted_by != player_id THEN score END),
            MAX(CASE WHEN submitted_by  = player_id THEN score END)
          ) AS score,
          COALESCE(
            MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
            MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
          ) AS stableford_points
        FROM competition_scores
        GROUP BY competition_id, player_id, hole_number
      ) cs ON cs.competition_id = e.competition_id AND cs.player_id = e.player_id
      WHERE e.competition_id = $1
      GROUP BY p.id, p.first_name, p.last_name, p.email, p.handicap, p.is_guest, e.handicap
      ORDER BY
        CASE WHEN $2 IN ('stroke','scramble','match_play','skins') THEN COALESCE(SUM(cs.score), 999) END ASC,
        CASE WHEN $2 = 'net_stroke' THEN (COALESCE(SUM(cs.score), 999) - FLOOR(COALESCE(e.handicap, p.handicap, 0))) END ASC,
        CASE WHEN $2 IN ('stableford','best_ball') THEN -COALESCE(SUM(cs.stableford_points), 0) END ASC,
        COUNT(cs.hole_number) DESC
    `, [competitionId, format]),

    pool.query(`
      SELECT player_id, hole_number,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN score END),
          MAX(CASE WHEN submitted_by  = player_id THEN score END)
        ) AS score,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
          MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
        ) AS stableford_points
      FROM competition_scores
      WHERE competition_id = $1
      GROUP BY player_id, hole_number
      ORDER BY player_id, hole_number
    `, [competitionId]),
  ]);

  const holesByPlayer = {};
  for (const row of holeRes.rows) {
    if (!holesByPlayer[row.player_id]) holesByPlayer[row.player_id] = [];
    holesByPlayer[row.player_id].push({
      hole_number: row.hole_number,
      score:       row.score,
      stableford_points: row.stableford_points,
    });
  }

  return {
    format,
    rows: result.rows.map(r => ({ ...r, hole_scores: holesByPlayer[r.id] || [] })),
  };
}

// ─── Per-player hole scores (for scorecard modal) ────────────────────────────

router.get('/:id/player/:playerId/scores', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        hole_number,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN score END),
          MAX(CASE WHEN submitted_by  = player_id THEN score END)
        ) AS score,
        COALESCE(
          MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
          MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
        ) AS stableford_points
      FROM competition_scores
      WHERE competition_id = $1 AND player_id = $2
      GROUP BY hole_number
      ORDER BY hole_number
    `, [req.params.id, req.params.playerId]);
    res.json(rows);
  } catch (err) {
    console.error('Player scores error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Scan scorecard image with Claude vision ─────────────────────────────────

router.post('/:id/scan-scorecard', requireAuth, async (req, res) => {
  const { imageBase64, mediaType } = req.body;
  if (!imageBase64 || !mediaType) {
    return res.status(400).json({ error: 'imageBase64 and mediaType required' });
  }
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(mediaType)) {
    return res.status(400).json({ error: 'Invalid media type' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'AI service not configured' });
  }
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: 'Extract all hole scores from this golf scorecard image. Return ONLY a JSON array in this exact format, with no other text: [{"hole": 1, "score": 4}, {"hole": 2, "score": 5}]. Include only holes where you can clearly read the score. If no scores are visible, return [].',
          },
        ],
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(422).json({ error: 'Could not extract scores from image' });

    const scores = JSON.parse(match[0]);
    if (!Array.isArray(scores)) return res.status(422).json({ error: 'Unexpected AI response' });

    res.json({ scores });
  } catch (err) {
    console.error('Scan scorecard error:', err);
    res.status(500).json({ error: 'Failed to scan scorecard' });
  }
});

// ─── Live leaderboard ────────────────────────────────────────────────────────

router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  try {
    const lb = await computeLeaderboard(req.params.id);
    if (!lb) return res.status(404).json({ error: 'Not found' });
    res.json(lb);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
