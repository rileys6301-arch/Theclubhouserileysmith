import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';
import { sendPushNotifications, getClubTokens } from '../utils/notify.js';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

// ─── Completed rounds for profile history ─────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, played_at, course_name, score, stableford, notes, created_at,
              slope_rating, course_rating, course_handicap, handicap_index, is_nine_hole
       FROM rounds
       WHERE user_id = $1 AND status = 'completed'
       ORDER BY played_at DESC, created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── All in-progress rounds (home page live feed) ─────────────────────────────

router.get('/live', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  try {
    const result = await pool.query(`
      SELECT
        r.id, r.course_name, r.tee_name, r.competition_id, r.created_at,
        u.id   AS user_id,
        u.first_name, u.last_name, u.email,
        COUNT(rh.id)::int                           AS holes_played,
        COALESCE(SUM(rh.stableford_points), 0)::int AS current_stableford,
        COALESCE(SUM(rh.score),            0)::int  AS current_score
      FROM rounds r
      JOIN  users u  ON u.id = r.user_id
      LEFT JOIN round_holes rh ON rh.round_id = r.id
      WHERE r.status = 'in_progress'
        AND ($1::int IS NULL OR u.id IN (
          SELECT user_id FROM club_memberships WHERE club_id = $1
        ))
      GROUP BY r.id, u.id, u.first_name, u.last_name, u.email
      ORDER BY r.created_at DESC
    `, [clubId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Live rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Recent rounds across ALL of the current user's clubs (home feed) ────────

router.get('/my-clubs-recent', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (r.id)
             r.id, r.played_at, r.course_name, r.score, r.stableford,
             r.course_handicap, r.is_nine_hole,
             u.id AS user_id, u.first_name, u.last_name, u.email
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      JOIN club_memberships cm ON cm.user_id = r.user_id
      WHERE cm.club_id IN (
        SELECT club_id FROM club_memberships WHERE user_id = $1
      )
      AND r.status = 'completed'
      AND r.played_at >= NOW() - INTERVAL '7 days'
      ORDER BY r.id, r.played_at DESC
    `, [req.userId]);
    // re-sort after DISTINCT ON
    rows.sort((a, b) => new Date(b.played_at).getTime() - new Date(a.played_at).getTime());
    res.json(rows.slice(0, 30));
  } catch (err) {
    console.error('My clubs recent rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Club members' completed rounds in the last 7 days ───────────────────────

router.get('/club-recent', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  if (!clubId) return res.status(400).json({ error: 'club_id required' });
  try {
    const { rows: membership } = await pool.query(
      'SELECT 1 FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!membership.length) return res.status(403).json({ error: 'Not a member' });

    const { rows } = await pool.query(`
      SELECT r.id, r.played_at, r.course_name, r.score, r.stableford, r.course_handicap, r.is_nine_hole,
             u.id AS user_id, u.first_name, u.last_name, u.email
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      JOIN club_memberships cm ON cm.club_id = $1 AND cm.user_id = r.user_id
      WHERE r.status = 'completed'
        AND r.played_at >= NOW() - INTERVAL '7 days'
      ORDER BY r.played_at DESC
      LIMIT 30
    `, [clubId]);
    res.json(rows);
  } catch (err) {
    console.error('Club recent rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Current user's in-progress round ─────────────────────────────────────────

router.get('/my-live', requireAuth, async (req, res) => {
  try {
    const roundRes = await pool.query(
      `SELECT * FROM rounds
       WHERE user_id = $1 AND status = 'in_progress'
       ORDER BY created_at DESC LIMIT 1`,
      [req.userId]
    );
    if (!roundRes.rows.length) return res.json(null);
    const round = roundRes.rows[0];

    const holesRes = await pool.query(
      `SELECT hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts
       FROM round_holes WHERE round_id = $1 ORDER BY hole_number`,
      [round.id]
    );
    res.json({ ...round, scored_holes: holesRes.rows });
  } catch (err) {
    console.error('My live round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create a group round session and notify invited players ──────────────────

router.post('/group', requireAuth, async (req, res) => {
  const { playerIds, courseName } = req.body;
  if (!Array.isArray(playerIds) || !playerIds.length) {
    return res.status(400).json({ error: 'playerIds required' });
  }

  const groupId = randomUUID();

  res.json({ groupId });

  (async () => {
    try {
      const { rows: [me] } = await pool.query(
        'SELECT first_name, last_name FROM users WHERE id = $1', [req.userId]
      );
      const name = [me?.first_name, me?.last_name].filter(Boolean).join(' ') || 'A player';
      const { rows: tokenRows } = await pool.query(
        `SELECT push_token FROM users WHERE id = ANY($1::int[]) AND push_token IS NOT NULL`,
        [playerIds]
      );
      const tokens = tokenRows.map(r => r.push_token);
      if (tokens.length) {
        await sendPushNotifications(tokens,
          '⛳ Group Round Invite!',
          `${name} wants to play a group round${courseName ? ` at ${courseName}` : ''}! Open the app to join. 🏌️`
        );
      }
    } catch {}
  })();
});

// ─── Live scores for a group round ────────────────────────────────────────────

router.get('/group/:groupId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        r.id, r.status, r.course_name,
        u.id AS user_id, u.first_name, u.last_name,
        COUNT(rh.id)::int                            AS holes_played,
        COALESCE(SUM(rh.stableford_points), 0)::int AS stableford,
        COALESCE(SUM(rh.score),            0)::int  AS gross_score
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN round_holes rh ON rh.round_id = r.id
      WHERE r.group_round_id = $1
      GROUP BY r.id, u.id, u.first_name, u.last_name
      ORDER BY stableford DESC, holes_played DESC
    `, [req.params.groupId]);
    res.json(rows);
  } catch (err) {
    console.error('Group scores error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Single round detail with hole-by-hole data ───────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  const roundId = req.params.id;
  if (!roundId) return res.status(400).json({ error: 'Invalid round id' });

  try {
    const { rows: [round] } = await pool.query(
      `SELECT r.*, u.first_name, u.last_name, u.email
       FROM rounds r
       JOIN users u ON u.id = r.user_id
       WHERE r.id = $1`,
      [roundId]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    if (round.user_id !== req.userId) {
      const { rows } = await pool.query(`
        SELECT 1 FROM club_memberships cm1
        JOIN club_memberships cm2 ON cm2.club_id = cm1.club_id AND cm2.user_id = $2
        WHERE cm1.user_id = $1 LIMIT 1
      `, [round.user_id, req.userId]);
      if (!rows.length) return res.status(403).json({ error: 'Not authorised' });
    }

    const { rows: holes } = await pool.query(
      `SELECT hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts
       FROM round_holes WHERE round_id = $1 ORDER BY hole_number`,
      [roundId]
    );

    res.json({ ...round, holes });
  } catch (err) {
    console.error('Get round detail error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create a completed round (batch entry from scorecard page) ───────────────

router.post('/', requireAuth, async (req, res) => {
  const {
    playedAt, courseName, score, stableford, notes, holes, clubId, roundType, scoringPartnerId, isNineHole,
    slopeRating, courseRating, courseHandicap,
  } = req.body;

  if (!playedAt || !courseName?.trim() || score == null || stableford == null) {
    return res.status(400).json({ error: 'Date, course, score, and stableford are required' });
  }

  const scoreInt      = parseInt(score,      10);
  const stablefordInt = parseInt(stableford, 10);
  const nineHole      = Boolean(isNineHole);
  const minScore      = nineHole ? 9 : 18;

  if (isNaN(scoreInt) || scoreInt < minScore || scoreInt > 200) {
    return res.status(400).json({ error: 'Score must be a realistic number of strokes' });
  }
  if (isNaN(stablefordInt) || stablefordInt < 0) {
    return res.status(400).json({ error: 'Invalid stableford total' });
  }

  const holesArr       = Array.isArray(holes) ? holes : [];
  const expectedHoles  = nineHole ? 9 : 18;
  if (holesArr.length > 0 && holesArr.length !== expectedHoles) {
    return res.status(400).json({ error: `Holes data must contain exactly ${expectedHoles} entries` });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const validTypes = ['social', 'scoring'];
    const rType = validTypes.includes(roundType) ? roundType : 'social';
    const roundResult = await client.query(
      `INSERT INTO rounds (user_id, played_at, course_name, score, stableford, notes, status, club_id, round_type, scoring_partner_id, is_nine_hole, slope_rating, course_rating, course_handicap)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, played_at, course_name, score, stableford, notes, created_at, round_type, is_nine_hole, slope_rating, course_rating, course_handicap`,
      [
        req.userId, playedAt, courseName.trim(), scoreInt, stablefordInt, notes?.trim() || null, clubId || null, rType, scoringPartnerId || null, nineHole,
        slopeRating    != null ? parseInt(slopeRating, 10)    : null,
        courseRating   != null ? parseFloat(courseRating)     : null,
        courseHandicap != null ? parseInt(courseHandicap, 10) : null,
      ]
    );
    const round = roundResult.rows[0];

    if (holesArr.length === expectedHoles) {
      for (const h of holesArr) {
        await client.query(
          `INSERT INTO round_holes
             (round_id, hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [round.id, h.holeNumber, h.par, h.strokeIndex, h.score, h.stablefordPoints,
           h.fairwayHit ?? null, h.gir ?? null, h.putts ?? null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(round);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create round error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Start a new live round ────────────────────────────────────────────────────

router.post('/start', requireAuth, async (req, res) => {
  const {
    playedAt, courseName, teeName,
    slopeRating, courseRating, courseHandicap, handicapIndex,
    holeData, competitionId, clubId, groupRoundId, isNineHole,
  } = req.body;

  if (!playedAt || !courseName?.trim()) {
    return res.status(400).json({ error: 'Date and course name are required' });
  }

  if (competitionId) {
    const entry = await pool.query(
      `SELECT e.id FROM competition_entries e
       JOIN competitions c ON c.id = e.competition_id
       WHERE e.competition_id = $1 AND e.player_id = $2 AND c.status = 'active'`,
      [competitionId, req.userId]
    );
    if (!entry.rows.length) {
      return res.status(400).json({ error: 'You are not entered in this active competition' });
    }
  }

  // Mark any previous in_progress round as abandoned so it never appears in the user's history.
  await pool.query(
    `UPDATE rounds SET status = 'abandoned' WHERE user_id = $1 AND status = 'in_progress'`,
    [req.userId]
  );

  try {
    const result = await pool.query(`
      INSERT INTO rounds
        (user_id, played_at, course_name, tee_name, slope_rating, course_rating, course_handicap,
         handicap_index, hole_data, score, stableford, status, competition_id, club_id, group_round_id, is_nine_hole)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0, 'in_progress', $10, $11, $12, $13)
      RETURNING *
    `, [
      req.userId,
      playedAt,
      courseName.trim(),
      teeName        || null,
      slopeRating    != null ? parseInt(slopeRating)     : null,
      courseRating   != null ? parseFloat(courseRating)  : null,
      courseHandicap != null ? parseInt(courseHandicap)  : null,
      handicapIndex  != null ? parseFloat(handicapIndex) : null,
      holeData ? JSON.stringify(holeData) : null,
      competitionId || null,
      clubId        || null,
      groupRoundId  || null,
      isNineHole ? true : false,
    ]);
    const newRound = result.rows[0];
    res.status(201).json(newRound);

    (async () => {
      try {
        const { rows: [user] } = await pool.query(
          'SELECT first_name, last_name FROM users WHERE id = $1', [req.userId]
        );
        const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'A player';
        const tokens = await getClubTokens(pool, clubId || null, req.userId);
        if (tokens.length) {
          await sendPushNotifications(tokens,
            '⛳ New Round Started!',
            `${name} just teed off at ${courseName.trim()}! Let's go! 🏌️`
          );
        }
      } catch {}
    })();
  } catch (err) {
    console.error('Start live round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Submit / update a single hole score ──────────────────────────────────────

router.patch('/:id/hole', requireAuth, async (req, res) => {
  const { holeNumber, par, strokeIndex, score, stablefordPoints, fairwayHit, gir, putts } = req.body;

  if (holeNumber == null || par == null || strokeIndex == null || score == null || stablefordPoints == null) {
    return res.status(400).json({ error: 'holeNumber, par, strokeIndex, score and stablefordPoints required' });
  }

  const roundRes = await pool.query(
    `SELECT id, status, competition_id FROM rounds WHERE id = $1 AND user_id = $2`,
    [req.params.id, req.userId]
  );
  if (!roundRes.rows.length) return res.status(404).json({ error: 'Round not found' });
  if (roundRes.rows[0].status !== 'in_progress') {
    return res.status(400).json({ error: 'Round is not in progress' });
  }
  const { competition_id } = roundRes.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO round_holes
        (round_id, hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (round_id, hole_number) DO UPDATE
        SET score = $5, stableford_points = $6, par = $3, stroke_index = $4,
            fairway_hit = $7, gir = $8, putts = $9
    `, [req.params.id, holeNumber, par, strokeIndex, score, stablefordPoints,
        fairwayHit ?? null, gir ?? null, putts ?? null]);

    const totals = await client.query(`
      SELECT
        COALESCE(SUM(score),            0)::int AS total_score,
        COALESCE(SUM(stableford_points), 0)::int AS total_stableford
      FROM round_holes WHERE round_id = $1
    `, [req.params.id]);

    await client.query(
      `UPDATE rounds SET score = $1, stableford = $2 WHERE id = $3`,
      [totals.rows[0].total_score, totals.rows[0].total_stableford, req.params.id]
    );

    if (competition_id) {
      await client.query(`
        INSERT INTO competition_scores
          (competition_id, player_id, hole_number, score, stableford_points, submitted_by)
        VALUES ($1, $2, $3, $4, $5, $2)
        ON CONFLICT (competition_id, player_id, hole_number) DO UPDATE
          SET score = $4, stableford_points = $5, submitted_by = $2, updated_at = NOW()
      `, [competition_id, req.userId, holeNumber, score, stablefordPoints]);
    }

    await client.query('COMMIT');

    const payload = {
      roundId:         parseInt(req.params.id),
      userId:          req.userId,
      holeNumber,
      score,
      stablefordPoints,
      totalScore:      totals.rows[0].total_score,
      totalStableford: totals.rows[0].total_stableford,
    };
    getIo()?.to(`round:${req.params.id}`).emit('score_update', payload);

    res.json({ ok: true, ...payload });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Submit hole error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }

  (async () => {
    try {
      const { rows: [roundInfo] } = await pool.query(
        `SELECT r.club_id, r.course_name, u.first_name, u.last_name
         FROM rounds r JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
        [req.params.id]
      );
      if (!roundInfo?.club_id) return;
      const name = [roundInfo.first_name, roundInfo.last_name].filter(Boolean).join(' ') || 'A player';
      const tokens = await getClubTokens(pool, roundInfo.club_id, req.userId);
      if (!tokens.length) return;
      const diff = score - par;
      if (diff <= -2) {
        await sendPushNotifications(tokens, '🦅 EAGLE! Incredible!',
          `${name} just made an eagle on hole ${holeNumber}! 🔥🔥🔥`);
      } else if (diff === -1) {
        await sendPushNotifications(tokens, '🐦 BIRDIE ALERT!',
          `${name} just carded a birdie on hole ${holeNumber}! Get in! 🎉`);
      } else if (stablefordPoints === 3) {
        await sendPushNotifications(tokens, '🔥 3 Points!',
          `${name} banked 3 stableford points on hole ${holeNumber}! Solid work! 💪`);
      }
      if (diff >= 3) {
        await sendPushNotifications(tokens, '😬 Wobble alert...',
          `${name} took a triple bogey on hole ${holeNumber}. Shake it off — you've got this! 💪`);
      }
    } catch {}
  })();
});

// ─── Backfill/edit tee & handicap info on an already-completed round ──────────
// Rounds saved without slope/course rating (e.g. the old past-round quick-entry
// flow, before it was fixed to send this data) are silently excluded from the
// Handicap Trend chart, which requires both to compute a WHS differential. This
// lets the player fill that in after the fact. Does NOT touch round_holes —
// each hole's stableford_points already reflects the handicap the player
// actually played off at save time, so nothing needs recomputing here.
router.patch('/:id/course-info', requireAuth, async (req, res) => {
  const { teeName, slopeRating, courseRating, courseHandicap } = req.body;

  const slope = slopeRating != null ? parseInt(slopeRating, 10) : null;
  const rating = courseRating != null ? parseFloat(courseRating) : null;
  const chcp = courseHandicap != null ? parseInt(courseHandicap, 10) : null;

  if (slope != null && (isNaN(slope) || slope < 55 || slope > 155)) {
    return res.status(400).json({ error: 'Slope rating must be between 55 and 155' });
  }
  if (rating != null && (isNaN(rating) || rating < 55 || rating > 85)) {
    return res.status(400).json({ error: 'Course rating must be between 55 and 85' });
  }
  if (chcp != null && (isNaN(chcp) || chcp < -10 || chcp > 54)) {
    return res.status(400).json({ error: 'Course handicap must be between -10 and 54' });
  }

  try {
    const { rows: [round] } = await pool.query(
      `UPDATE rounds
       SET tee_name = $1, slope_rating = $2, course_rating = $3, course_handicap = $4
       WHERE id = $5 AND user_id = $6 AND status = 'completed'
       RETURNING id, tee_name, slope_rating, course_rating, course_handicap`,
      [teeName?.trim() || null, slope, rating, chcp, req.params.id, req.userId]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });
    res.json(round);
  } catch (err) {
    console.error('Update round course info error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Edit holes on an already-completed round (self-service correction) ───────
// Lets a player fix a mis-entered score or fill in fairway/GIR/putts stats after
// the round was saved. Unlike PATCH /:id/hole (live scoring only), this requires
// status = 'completed'. Stableford is recomputed per hole by deriving that
// hole's original handicap allowance (shots received) from its own pre-edit
// score/points, rather than from rounds.course_handicap — that column is only
// populated for live-scored rounds; rounds entered via the past-round batch
// flow never save it, even though the per-hole stableford was correctly
// computed client-side at the time. Reconstructing the allowance this way
// preserves the handicap the player actually played off for this round.
router.patch('/:id/holes', requireAuth, async (req, res) => {
  const { holes } = req.body; // [{ holeNumber, score, fairwayHit, gir, putts }]
  if (!Array.isArray(holes) || !holes.length) {
    return res.status(400).json({ error: 'holes array required' });
  }

  const { rows: [round] } = await pool.query(
    `SELECT id, course_handicap FROM rounds WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
    [req.params.id, req.userId]
  );
  if (!round) return res.status(404).json({ error: 'Round not found' });
  const ph = round.course_handicap ?? 0; // fallback only — see note below

  const { rows: existing } = await pool.query(
    `SELECT hole_number, par, stroke_index, score, stableford_points FROM round_holes WHERE round_id = $1`,
    [req.params.id]
  );
  const holeInfo = Object.fromEntries(existing.map(h => [h.hole_number, h]));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const h of holes) {
      const info = holeInfo[h.holeNumber];
      if (!info) continue; // unknown hole number for this round — skip rather than invent one

      const par = info.par ?? 4;
      const si  = info.stroke_index ?? h.holeNumber;
      const score = h.score != null ? parseInt(h.score, 10) : null;
      if (score == null || isNaN(score) || score < 1) continue;

      // shotsReceived is constant for a hole regardless of a score correction —
      // it's determined by the player's handicap at the time, not by this edit.
      // Recover it algebraically from stableford = par - (prevScore - shotsReceived) + 2,
      // i.e. shotsReceived = prevStableford - par - 2 + prevScore. Only falls back to
      // rounds.course_handicap when the previous points were clamped at 0 (ambiguous).
      const shotsReceived = info.stableford_points > 0
        ? info.stableford_points - par - 2 + info.score
        : Math.floor(ph / 18) + (si <= (ph % 18) ? 1 : 0);
      const netScore = score - shotsReceived;
      const stableford = Math.max(0, par - netScore + 2);

      await client.query(`
        UPDATE round_holes
        SET score = $1, stableford_points = $2,
            fairway_hit = $3, gir = $4, putts = $5
        WHERE round_id = $6 AND hole_number = $7
      `, [
        score, stableford,
        h.fairwayHit ?? null, h.gir ?? null, h.putts ?? null,
        req.params.id, h.holeNumber,
      ]);
    }

    const { rows: [totals] } = await client.query(`
      SELECT COALESCE(SUM(score), 0)::int            AS total_score,
             COALESCE(SUM(stableford_points), 0)::int AS total_stableford
      FROM round_holes WHERE round_id = $1
    `, [req.params.id]);

    await client.query(
      `UPDATE rounds SET score = $1, stableford = $2 WHERE id = $3`,
      [totals.total_score, totals.total_stableford, req.params.id]
    );

    await client.query('COMMIT');

    const { rows: updatedHoles } = await pool.query(
      `SELECT hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts
       FROM round_holes WHERE round_id = $1 ORDER BY hole_number`,
      [req.params.id]
    );

    res.json({ score: totals.total_score, stableford: totals.total_stableford, holes: updatedHoles });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Edit round holes error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Finalise a live round ─────────────────────────────────────────────────────

router.post('/:id/finish', requireAuth, async (req, res) => {
  const { roundType, scoringPartnerId, holes } = req.body;
  const validTypes = ['social', 'scoring'];
  const rType = validTypes.includes(roundType) ? roundType : 'social';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [owned] } = await client.query(
      `SELECT id FROM rounds WHERE id = $1 AND user_id = $2 AND status = 'in_progress'`,
      [req.params.id, req.userId]
    );
    if (!owned) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active round not found' });
    }

    // Fallback sync: on courses with patchy signal, individual PATCH /:id/hole calls
    // made during play can fail silently (client swallows the error and just retries
    // on the next save). Without this, a round can finish with round_holes rows missing
    // for whichever holes never had a successful connection, so the scorecard shows up
    // empty/partial even though the player entered every hole. The client sends its full
    // local scoring state here as a last-resort upsert so finishing never loses holes.
    if (Array.isArray(holes)) {
      for (const h of holes) {
        const holeNumber = parseInt(h?.holeNumber, 10);
        const par = parseInt(h?.par, 10);
        const strokeIndex = parseInt(h?.strokeIndex, 10);
        const score = parseInt(h?.score, 10);
        const stablefordPoints = parseInt(h?.stablefordPoints, 10);
        if ([holeNumber, par, strokeIndex, score, stablefordPoints].some(Number.isNaN)) continue;

        await client.query(`
          INSERT INTO round_holes
            (round_id, hole_number, par, stroke_index, score, stableford_points)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (round_id, hole_number) DO UPDATE
            SET score = $5, stableford_points = $6, par = $3, stroke_index = $4
        `, [req.params.id, holeNumber, par, strokeIndex, score, stablefordPoints]);
      }
    }

    // Recalculate totals from hole data — concurrent patches can leave stale totals
    const { rows: [totals] } = await client.query(`
      SELECT
        COALESCE(SUM(score),             0)::int AS total_score,
        COALESCE(SUM(stableford_points), 0)::int AS total_stableford
      FROM round_holes WHERE round_id = $1
    `, [req.params.id]);

    const result = await client.query(`
      UPDATE rounds
      SET status = 'completed', score = $3, stableford = $4,
          round_type = $5, scoring_partner_id = $6
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
      RETURNING id, played_at, course_name, score, stableford, notes, created_at, round_type,
                slope_rating, course_rating, handicap_index
    `, [req.params.id, req.userId, totals.total_score, totals.total_stableford, rType, scoringPartnerId || null]);

    await client.query('COMMIT');

    if (!result.rows.length) return res.status(404).json({ error: 'Active round not found' });
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Finish round error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── Delete / abandon a round ──────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM rounds WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Round not found' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('Delete round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Upload photo to a round ─────────────────────────────────────────────────

router.post('/:id/photo', requireAuth, async (req, res) => {
  const { photo_data } = req.body;
  if (!photo_data) return res.status(400).json({ error: 'photo_data is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE rounds SET photo_data = $1 WHERE id = $2 AND user_id = $3 RETURNING id`,
      [photo_data, req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Round not found or not yours' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Round comments ───────────────────────────────────────────────────────────

router.get('/:id/comments', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.body, c.created_at, c.user_id,
             u.first_name, u.last_name, u.email
      FROM round_comments c
      JOIN users u ON u.id = c.user_id
      WHERE c.round_id = $1
      ORDER BY c.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Get comments error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/comments', requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  try {
    const { rows: [comment] } = await pool.query(`
      INSERT INTO round_comments (round_id, user_id, body)
      VALUES ($1, $2, $3)
      RETURNING id, body, created_at, user_id
    `, [req.params.id, req.userId, body.trim()]);
    const { rows: [user] } = await pool.query(
      'SELECT first_name, last_name, email FROM users WHERE id = $1', [req.userId]
    );
    res.status(201).json({ ...comment, ...user });
  } catch (err) {
    console.error('Add comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM round_comments WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.commentId, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Round reactions ──────────────────────────────────────────────────────────

const ALLOWED_ROUND_EMOJIS = ['👍', '❤️', '🔥', '😮'];

router.post('/:id/reactions', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED_ROUND_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  try {
    const existing = await pool.query(
      'SELECT id FROM round_reactions WHERE round_id = $1 AND user_id = $2 AND emoji = $3',
      [req.params.id, req.userId, emoji]
    );
    if (existing.rows.length) {
      await pool.query('DELETE FROM round_reactions WHERE id = $1', [existing.rows[0].id]);
      res.json({ action: 'removed' });
    } else {
      await pool.query(
        'INSERT INTO round_reactions (round_id, user_id, emoji) VALUES ($1, $2, $3)',
        [req.params.id, req.userId, emoji]
      );
      res.json({ action: 'added' });
    }
  } catch (err) {
    console.error('Reaction error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Scan scorecard image (standalone round) ─────────────────────────────────

router.post('/scan-scorecard', requireAuth, async (req, res) => {
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
            text: `You are reading a golf scorecard image. Extract ALL of the following and return ONLY valid JSON with no other text:

{"scores":[{"hole":1,"score":4},{"hole":2,"score":3}],"holes":[{"hole":1,"par":4,"si":5},{"hole":2,"par":4,"si":12}],"pickups":[7],"courseName":"Royal Golf Club","teeName":"Yellow","stablefordTotal":32}

Look carefully for these rows on the card:
- PAR row (labelled "Par" or "Course Par"): the par value (3, 4 or 5) for EVERY hole — include all holes shown
- INDEX row (labelled "Index", "SI", "Stroke Index" or "Handicap"): the index number (1–18) for EVERY hole — include all holes shown
- SCORE row: the player's numeric score per hole
- STABLEFORD row (labelled "Stableford", "Points" or similar): total or per-hole points

Rules:
- "scores": only holes with a clearly readable numeric score
- "holes": par AND si for EVERY hole visible on the card — read the full Par row and Index row, not just scored holes. This is the most important field.
- "pickups": hole numbers where the score shows "P", "PU" or "pick up" — do NOT add to scores
- "courseName": club/course name from the card header, or null
- "teeName": tee colour/name (e.g. "Yellow", "White", "Red"), or null
- "stablefordTotal": total stableford points from the card, or null
- Use JSON null (not the string "null") for missing fields`,
          },
        ],
      }],
    });

    const text  = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not extract scores from image' });

    const parsed = JSON.parse(match[0]);
    const scores          = Array.isArray(parsed.scores)  ? parsed.scores  : [];
    const holes           = Array.isArray(parsed.holes)   ? parsed.holes   : [];
    const pickups         = Array.isArray(parsed.pickups) ? parsed.pickups : [];
    const courseName      = parsed.courseName      ?? null;
    const teeName         = parsed.teeName         ?? null;
    const stablefordTotal = parsed.stablefordTotal ?? null;

    res.json({ scores, holes, pickups, courseName, teeName, stablefordTotal });
  } catch (err) {
    console.error('Scan scorecard error:', err);
    res.status(500).json({ error: 'Failed to scan scorecard', detail: err.message });
  }
});

export default router;
