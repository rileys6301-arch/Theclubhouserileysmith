import express from 'express';
import { randomUUID } from 'crypto';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';
import { sendPushNotifications, getClubTokens } from '../utils/notify.js';

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
  const { playedAt, courseName, score, stableford, notes, holes, clubId, roundType, scoringPartnerId, isNineHole } = req.body;

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
      `INSERT INTO rounds (user_id, played_at, course_name, score, stableford, notes, status, club_id, round_type, scoring_partner_id, is_nine_hole)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10)
       RETURNING id, played_at, course_name, score, stableford, notes, created_at, round_type, is_nine_hole`,
      [req.userId, playedAt, courseName.trim(), scoreInt, stablefordInt, notes?.trim() || null, clubId || null, rType, scoringPartnerId || null, nineHole]
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

  await pool.query(
    `UPDATE rounds SET status = 'completed' WHERE user_id = $1 AND status = 'in_progress'`,
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

// ─── Finalise a live round ─────────────────────────────────────────────────────

router.post('/:id/finish', requireAuth, async (req, res) => {
  const { roundType, scoringPartnerId } = req.body;
  const validTypes = ['social', 'scoring'];
  const rType = validTypes.includes(roundType) ? roundType : 'social';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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

export default router;
