import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, played_at, course_name, score, stableford, notes, created_at
       FROM rounds
       WHERE user_id = $1
       ORDER BY played_at DESC, created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { playedAt, courseName, score, stableford, notes, holes } = req.body;

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

  // Validate holes array when provided
  const holesArr = Array.isArray(holes) ? holes : [];
  if (holesArr.length > 0 && holesArr.length !== 18) {
    return res.status(400).json({ error: 'Holes data must contain exactly 18 entries' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roundResult = await client.query(
      `INSERT INTO rounds (user_id, played_at, course_name, score, stableford, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, played_at, course_name, score, stableford, notes, created_at`,
      [req.userId, playedAt, courseName.trim(), scoreInt, stablefordInt, notes?.trim() || null]
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
