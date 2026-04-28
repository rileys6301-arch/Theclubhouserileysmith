import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/social/leaderboard — all users ranked by avg stableford
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.handicap,
        COUNT(r.id)::int AS rounds_played,
        ROUND(AVG(r.stableford)::numeric,1)::float AS avg_stableford,
        MAX(r.stableford)::int AS best_stableford,
        MIN(r.score)::int AS best_score
      FROM users u JOIN rounds r ON r.user_id = u.id
      GROUP BY u.id ORDER BY avg_stableford DESC NULLS LAST
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/birdies — net birdies per user
router.get('/birdies', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email,
        COUNT(CASE WHEN rh.stableford_points = 2 THEN 1 END)::int  AS birdies,
        COUNT(CASE WHEN rh.stableford_points >= 3 THEN 1 END)::int AS eagles_plus,
        COUNT(CASE WHEN rh.stableford_points >= 2 THEN 1 END)::int AS total
      FROM users u JOIN rounds r ON r.user_id = u.id
      JOIN round_holes rh ON rh.round_id = r.id
      GROUP BY u.id HAVING COUNT(CASE WHEN rh.stableford_points >= 2 THEN 1 END) > 0
      ORDER BY total DESC, eagles_plus DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Birdies error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/best-rounds — top 10 rounds by stableford
router.get('/best-rounds', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.course_name, r.played_at, r.score, r.stableford,
        u.first_name, u.last_name, u.email, u.id AS user_id
      FROM rounds r JOIN users u ON u.id = r.user_id
      ORDER BY r.stableford DESC, r.score ASC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Best rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
