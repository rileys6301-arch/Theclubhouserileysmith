import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getIo } from '../socket.js';

const router = express.Router();

// ─── Completed rounds for profile history ─────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, played_at, course_name, score, stableford, notes, created_at
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
      `SELECT hole_number, par, stroke_index, score, stableford_points
       FROM round_holes WHERE round_id = $1 ORDER BY hole_number`,
      [round.id]
    );
    res.json({ ...round, scored_holes: holesRes.rows });
  } catch (err) {
    console.error('My live round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create a completed round (batch entry from scorecard page) ───────────────

router.post('/', requireAuth, async (req, res) => {
  const { playedAt, courseName, score, stableford, notes, holes, clubId } = req.body;

  if (!playedAt || !courseName?.trim() || score == null || stableford == null) {
    return res.status(400).json({ error: 'Date, course, score, and stableford are required' });
  }

  const scoreInt      = parseInt(score,      10);
  const stablefordInt = parseInt(stableford, 10);

  if (isNaN(scoreInt) || scoreInt < 18 || scoreInt > 200) {
    return res.status(400).json({ error: 'Score must be a realistic number of strokes' });
  }
  if (isNaN(stablefordInt) || stablefordInt < 0) {
    return res.status(400).json({ error: 'Invalid stableford total' });
  }

  const holesArr = Array.isArray(holes) ? holes : [];
  if (holesArr.length > 0 && holesArr.length !== 18) {
    return res.status(400).json({ error: 'Holes data must contain exactly 18 entries' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `INSERT INTO rounds (user_id, played_at, course_name, score, stableford, notes, status, club_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
       RETURNING id, played_at, course_name, score, stableford, notes, created_at`,
      [req.userId, playedAt, courseName.trim(), scoreInt, stablefordInt, notes?.trim() || null, clubId || null]
    );
    const round = roundResult.rows[0];

    if (holesArr.length === 18) {
      for (const h of holesArr) {
        await client.query(
          `INSERT INTO round_holes
             (round_id, hole_number, par, stroke_index, score, stableford_points)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [round.id, h.holeNumber, h.par, h.strokeIndex, h.score, h.stablefordPoints]
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
    holeData, competitionId, clubId,
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
        (user_id, played_at, course_name, tee_name, slope_rating, course_handicap,
         handicap_index, hole_data, score, stableford, status, competition_id, club_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, 'in_progress', $9, $10)
      RETURNING *
    `, [
      req.userId,
      playedAt,
      courseName.trim(),
      teeName    || null,
      slopeRating    != null ? parseInt(slopeRating)    : null,
      courseHandicap != null ? parseInt(courseHandicap) : null,
      handicapIndex  != null ? parseFloat(handicapIndex) : null,
      holeData ? JSON.stringify(holeData) : null,
      competitionId || null,
      clubId        || null,
    ]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Start live round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Submit / update a single hole score ──────────────────────────────────────

router.patch('/:id/hole', requireAuth, async (req, res) => {
  const { holeNumber, par, strokeIndex, score, stablefordPoints } = req.body;

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
        (round_id, hole_number, par, stroke_index, score, stableford_points)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (round_id, hole_number) DO UPDATE
        SET score = $5, stableford_points = $6, par = $3, stroke_index = $4
    `, [req.params.id, holeNumber, par, strokeIndex, score, stablefordPoints]);

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
});

// ─── Finalise a live round ─────────────────────────────────────────────────────

router.post('/:id/finish', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE rounds SET status = 'completed'
      WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
      RETURNING id, played_at, course_name, score, stableford, notes, created_at
    `, [req.params.id, req.userId]);

    if (!result.rows.length) return res.status(404).json({ error: 'Active round not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Finish round error:', err);
    res.status(500).json({ error: 'Server error' });
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

export default router;
