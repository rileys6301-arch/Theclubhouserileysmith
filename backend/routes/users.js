import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, handicap, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users — list all users with round counts
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.handicap, u.created_at,
        COUNT(r.id)::int AS rounds_played
      FROM users u
      LEFT JOIN rounds r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.first_name, u.last_name, u.email
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/profile', requireAuth, async (req, res) => {
  const { firstName, lastName, handicap } = req.body;

  if (handicap !== undefined && handicap !== null) {
    const h = parseFloat(handicap);
    if (isNaN(h) || h < -10 || h > 54) {
      return res.status(400).json({ error: 'Handicap must be between -10 and 54' });
    }
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         handicap   = COALESCE($3::DECIMAL, handicap),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, first_name, last_name, handicap, created_at`,
      [
        firstName?.trim() || null,
        lastName?.trim() || null,
        handicap != null ? handicap : null,
        req.userId,
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id — public profile for one user
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.handicap, u.created_at,
        COUNT(r.id)::int AS rounds_played,
        ROUND(AVG(r.stableford)::numeric,1)::float AS avg_stableford,
        MAX(r.stableford)::int AS best_stableford,
        MIN(r.score)::int AS best_score
      FROM users u
      LEFT JOIN rounds r ON r.user_id = u.id
      WHERE u.id = $1
      GROUP BY u.id
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/rounds — that user's rounds, newest first
router.get('/:id/rounds', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, played_at, course_name, score, stableford, notes, created_at
      FROM rounds
      WHERE user_id = $1
      ORDER BY played_at DESC, created_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get user rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
