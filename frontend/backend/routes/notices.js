import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/notices?club_id=X
router.get('/', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  try {
    const result = await pool.query(`
      SELECT n.id, n.title, n.body, n.created_at,
        n.user_id,
        u.first_name, u.last_name, u.email
      FROM notices n
      JOIN users u ON u.id = n.user_id
      WHERE ($1::int IS NULL OR n.club_id = $1)
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [clubId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get notices error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notices — body: { title, body, clubId? }
router.post('/', requireAuth, async (req, res) => {
  const { title, body, clubId } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }
  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Body is required' });
  }
  if (title.trim().length > 200) {
    return res.status(400).json({ error: 'Title must be 200 characters or fewer' });
  }

  if (clubId) {
    try {
      const { rows } = await pool.query(
        'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
        [clubId, req.userId]
      );
      if (!rows.length || rows[0].role !== 'owner') {
        return res.status(403).json({ error: 'Only club owners can post notices' });
      }
    } catch (err) {
      console.error('Notice auth check error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  try {
    const result = await pool.query(`
      INSERT INTO notices (user_id, title, body, club_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, title, body, created_at, user_id
    `, [req.userId, title.trim(), body.trim(), clubId || null]);

    const notice = result.rows[0];
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

// DELETE /api/notices/:id
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
