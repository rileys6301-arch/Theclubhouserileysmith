import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ─── List all competitions ────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.id, c.name, c.description, c.date, c.course_name, c.tee_name,
        c.status, c.created_by, c.created_at,
        COUNT(DISTINCT e.player_id)::int AS entry_count,
        BOOL_OR(e.player_id = $1)       AS entered,
        cu.first_name AS creator_first, cu.last_name AS creator_last, cu.email AS creator_email
      FROM competitions c
      LEFT JOIN competition_entries e  ON e.competition_id = c.id
      LEFT JOIN users cu               ON cu.id = c.created_by
      GROUP BY c.id, cu.first_name, cu.last_name, cu.email
      ORDER BY
        CASE c.status WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END,
        c.date DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('List competitions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Create competition ───────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  const { name, description, date, courseName, teeName, holeData } = req.body;
  if (!name?.trim() || !date || !courseName?.trim()) {
    return res.status(400).json({ error: 'Name, date and course are required' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO competitions (name, description, date, course_name, tee_name, hole_data, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      name.trim(),
      description?.trim() || null,
      date,
      courseName.trim(),
      teeName || null,
      holeData ? JSON.stringify(holeData) : null,
      req.userId,
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
      LEFT JOIN competition_scores cs
             ON cs.competition_id = e.competition_id AND cs.player_id = e.player_id
      WHERE e.competition_id = $1
      GROUP BY e.id, e.player_id, e.scorer_id, e.created_at,
               p.first_name, p.last_name, p.email, p.handicap,
               s.first_name, s.last_name, s.email
      ORDER BY total_stableford DESC, holes_played DESC
    `, [req.params.id]);

    const entries   = entriesRes.rows;
    const myEntry   = entries.find(e => e.player_id   === req.userId) ?? null;
    const scoringFor= entries.find(e => e.scorer_id   === req.userId) ?? null;

    // Pre-load submitted scores for the player the current user is scoring for
    let liveScores = [];
    if (scoringFor) {
      const scRes = await pool.query(`
        SELECT hole_number, score, stableford_points
        FROM competition_scores
        WHERE competition_id = $1 AND player_id = $2
        ORDER BY hole_number
      `, [req.params.id, scoringFor.player_id]);
      liveScores = scRes.rows;
    }

    res.json({
      ...comp,
      entries,
      myEntry,
      scoringFor,
      liveScores,
      isCreator: comp.created_by === req.userId,
    });
  } catch (err) {
    console.error('Get competition error:', err);
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
// Body: { pairs: [{playerId, scorerId}, ...] }
// Send both directions to achieve symmetric pairing.

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

// ─── Submit / update a hole score ────────────────────────────────────────────
// The logged-in user must be the assigned scorer for the target player.

router.post('/:id/scores', requireAuth, async (req, res) => {
  const { playerId, holeNumber, score, stablefordPoints } = req.body;
  if (!playerId || !holeNumber || score == null || stablefordPoints == null) {
    return res.status(400).json({ error: 'playerId, holeNumber, score and stablefordPoints required' });
  }
  try {
    const comp = await pool.query('SELECT status FROM competitions WHERE id = $1', [req.params.id]);
    if (!comp.rows.length) return res.status(404).json({ error: 'Not found' });
    if (comp.rows[0].status !== 'active') {
      return res.status(400).json({ error: 'Competition is not active' });
    }

    const entry = await pool.query(
      `SELECT scorer_id, player_id FROM competition_entries
       WHERE competition_id = $1 AND player_id = $2`,
      [req.params.id, playerId]
    );
    if (!entry.rows.length) return res.status(404).json({ error: 'Player not in competition' });
    if (entry.rows[0].scorer_id !== req.userId) {
      return res.status(403).json({ error: 'You are not the assigned scorer for this player' });
    }

    const result = await pool.query(`
      INSERT INTO competition_scores
        (competition_id, player_id, hole_number, score, stableford_points, submitted_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (competition_id, player_id, hole_number) DO UPDATE
        SET score = $4, stableford_points = $5, submitted_by = $6, updated_at = NOW()
      RETURNING *
    `, [req.params.id, playerId, holeNumber, score, stablefordPoints, req.userId]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Submit score error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Live leaderboard ────────────────────────────────────────────────────────

router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.id, p.first_name, p.last_name, p.email, p.handicap,
        COALESCE(SUM(cs.stableford_points), 0)::int AS total_stableford,
        COALESCE(SUM(cs.score),            0)::int AS total_strokes,
        COUNT(cs.hole_number)::int                  AS holes_played,
        s.first_name AS scorer_first, s.last_name AS scorer_last, s.email AS scorer_email
      FROM competition_entries e
      JOIN  users p  ON p.id = e.player_id
      LEFT JOIN users s  ON s.id = e.scorer_id
      LEFT JOIN competition_scores cs
             ON cs.competition_id = e.competition_id AND cs.player_id = e.player_id
      WHERE e.competition_id = $1
      GROUP BY p.id, p.first_name, p.last_name, p.email, p.handicap,
               s.first_name, s.last_name, s.email
      ORDER BY total_stableford DESC, holes_played DESC, total_strokes ASC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
