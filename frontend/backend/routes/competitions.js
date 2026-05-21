import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';

const router = express.Router();

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
  const { name, description, date, courseName, teeName, holeData, clubId, format, teamSize } = req.body;
  if (!name?.trim() || !date || !courseName?.trim()) {
    return res.status(400).json({ error: 'Name, date and course are required' });
  }
  const fmt = VALID_FORMATS.includes(format) ? format : 'stableford';
  const ts  = ['scramble', 'best_ball'].includes(fmt) ? Math.max(2, Math.min(4, parseInt(teamSize) || 2)) : 1;
  try {
    const result = await pool.query(`
      INSERT INTO competitions (name, description, date, course_name, tee_name, hole_data, created_by, club_id, format, team_size)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create competition error:', err);
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
        e.id, e.player_id, e.scorer_id, e.created_at,
        p.first_name AS player_first, p.last_name AS player_last,
        p.email AS player_email, p.handicap,
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
      GROUP BY e.id, e.player_id, e.scorer_id, e.created_at,
               p.first_name, p.last_name, p.email, p.handicap,
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
    const result = await pool.query(
      `UPDATE competitions SET status = $1 WHERE id = $2 AND created_by = $3 RETURNING *`,
      [status, req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(403).json({ error: 'Not authorised' });
    res.json(result.rows[0]);
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

// ─── Set scoring pairs (creator only) ────────────────────────────────────────

router.patch('/:id/pairs', requireAuth, async (req, res) => {
  const { pairs } = req.body;
  if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs must be an array' });

  try {
    const comp = await pool.query('SELECT created_by FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].created_by !== req.userId) return res.status(403).json({ error: 'Not authorised' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const { playerId, scorerId } of pairs) {
        await client.query(
          `UPDATE competition_entries SET scorer_id = $1
           WHERE competition_id = $2 AND player_id = $3`,
          [scorerId, req.params.id, playerId]
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
    const comp = await pool.query('SELECT status FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].status === 'completed') {
      return res.status(400).json({ error: 'Competition is already completed' });
    }

    // Auto-activate upcoming competition when first score arrives
    if (comp.rows[0].status === 'upcoming') {
      await pool.query(`UPDATE competitions SET status = 'active' WHERE id = $1`, [req.params.id]);
    }

    const entry = await pool.query(
      `SELECT scorer_id, player_id FROM competition_entries
       WHERE competition_id = $1 AND player_id = $2`,
      [req.params.id, playerId]
    );
    if (!entry.rows.length) return res.status(404).json({ error: 'Player not in competition' });
    const isSelf = playerId === req.userId;
    if (!isSelf && entry.rows[0].scorer_id !== req.userId) {
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

async function computeLeaderboard(competitionId) {
  const compRes = await pool.query('SELECT format FROM competitions WHERE id = $1', [competitionId]);
  if (!compRes.rows.length) return null;
  const { format } = compRes.rows[0];

  const result = await pool.query(`
    SELECT
      p.id, p.first_name, p.last_name, p.email, p.handicap,
      COALESCE(SUM(cs.stableford_points), 0)::int AS total_stableford,
      COALESCE(SUM(cs.score),            0)::int AS total_strokes,
      COUNT(cs.hole_number)::int                  AS holes_played,
      (COALESCE(SUM(cs.score), 0) - FLOOR(COALESCE(p.handicap, 0)))::int AS net_strokes
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
    GROUP BY p.id, p.first_name, p.last_name, p.email, p.handicap
    ORDER BY
      CASE WHEN $2 IN ('stroke','scramble','match_play','skins') THEN COALESCE(SUM(cs.score), 999) END ASC,
      CASE WHEN $2 = 'net_stroke' THEN (COALESCE(SUM(cs.score), 999) - FLOOR(COALESCE(p.handicap,0))) END ASC,
      CASE WHEN $2 IN ('stableford','best_ball') THEN -COALESCE(SUM(cs.stableford_points), 0) END ASC,
      COUNT(cs.hole_number) DESC
  `, [competitionId, format]);

  return { format, rows: result.rows };
}

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
