import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notices — all notices, newest first, limit 50
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.id, n.title, n.body, n.created_at,
        n.user_id,
        u.first_name, u.last_name, u.email
      FROM notices n
      JOIN users u ON u.id = n.user_id
      ORDER BY n.created_at DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Get notices error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notices — create a notice
router.post('/', requireAuth, async (req, res) => {
  const { title, body } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Body is required' });
  }
  if (title.trim().length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or fewer' });
  }

  try {
    const result = await pool.query(`
      INSERT INTO notices (user_id, title, body)
      VALUES ($1, $2, $3)
      RETURNING id, title, body, created_at, user_id
    `, [req.userId, title.trim(), body.trim()]);

    const notice = result.rows[0];

    // Return with author info
    const userResult = await pool.query(
      'SELECT first_name, last_name, email FROM users WHERE id = $1',
      [req.userId]
    );
    res.status(201).json({ ...notice, ...userResult.rows[0] });
  } catch (err) {
    console.error('Create notice error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notices/:id — delete own notice only
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM notices WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Notice not found or not yours' });
    }
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('Delete notice error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
