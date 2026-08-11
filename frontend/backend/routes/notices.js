import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_EMOJIS = ['👍', '❤️', '😂', '😮'];

// Shared helper — build reaction summary for a list of notice IDs
async function reactionSummary(noticeIds, userId) {
  if (!noticeIds.length) return {};
  const { rows } = await pool.query(
    `SELECT notice_id, emoji, COUNT(*)::int AS count,
            bool_or(user_id = $2) AS reacted
     FROM notice_reactions
     WHERE notice_id = ANY($1::uuid[])
     GROUP BY notice_id, emoji`,
    [noticeIds, userId]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.notice_id]) map[r.notice_id] = {};
    map[r.notice_id][r.emoji] = { count: r.count, reacted: r.reacted };
  }
  return map;
}

// GET /api/notices?club_id=X
// Returns notices with first photo, comment count, and reaction summary
router.get('/', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  try {
    const { rows: notices } = await pool.query(`
      SELECT n.id, n.title, n.body, n.created_at, n.user_id,
             u.first_name, u.last_name, u.email,
             (SELECT photo_data FROM notice_photos WHERE notice_id = n.id ORDER BY created_at LIMIT 1) AS photo_url,
             (SELECT COUNT(*)::int FROM notice_comments WHERE notice_id = n.id) AS comment_count
      FROM notices n
      JOIN users u ON u.id = n.user_id
      WHERE ($1::int IS NULL OR n.club_id = $1)
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [clubId]);

    const ids = notices.map(n => n.id);
    const reactions = await reactionSummary(ids, req.userId);
    const result = notices.map(n => ({ ...n, reactions: reactions[n.id] || {} }));
    res.json(result);
  } catch (err) {
    console.error('Get notices error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/notices/:id — full detail with comments and reactions
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: [notice] } = await pool.query(`
      SELECT n.id, n.title, n.body, n.created_at, n.user_id,
             u.first_name, u.last_name, u.email
      FROM notices n
      JOIN users u ON u.id = n.user_id
      WHERE n.id = $1
    `, [req.params.id]);
    if (!notice) return res.status(404).json({ error: 'Not found' });

    const [photosRes, commentsRes, reactionsMap] = await Promise.all([
      pool.query(`SELECT id, photo_data FROM notice_photos WHERE notice_id = $1 ORDER BY created_at`, [req.params.id]),
      pool.query(`
        SELECT c.id, c.body, c.created_at, c.user_id,
               u.first_name, u.last_name, u.email
        FROM notice_comments c
        JOIN users u ON u.id = c.user_id
        WHERE c.notice_id = $1
        ORDER BY c.created_at ASC
      `, [req.params.id]),
      reactionSummary([req.params.id], req.userId),
    ]);

    res.json({
      ...notice,
      photos: photosRes.rows,
      comments: commentsRes.rows,
      reactions: reactionsMap[req.params.id] || {},
    });
  } catch (err) {
    console.error('Get notice detail error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notices — body: { title, body, clubId?, photo_data? }
router.post('/', requireAuth, async (req, res) => {
  const { title, body, clubId, photo_data } = req.body;

  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!body  || !body.trim())  return res.status(400).json({ error: 'Body is required' });
  if (title.trim().length > 200) return res.status(400).json({ error: 'Title must be 200 characters or fewer' });

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
      return res.status(500).json({ error: 'Server error' });
    }
  }

  try {
    const { rows: [notice] } = await pool.query(`
      INSERT INTO notices (user_id, title, body, club_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, title, body, created_at, user_id
    `, [req.userId, title.trim(), body.trim(), clubId || null]);

    const { rows: [user] } = await pool.query(
      'SELECT first_name, last_name, email FROM users WHERE id = $1', [req.userId]
    );

    let photo_url = null;
    if (photo_data) {
      await pool.query(
        'INSERT INTO notice_photos (notice_id, photo_data) VALUES ($1, $2)',
        [notice.id, photo_data]
      );
      photo_url = photo_data;
    }

    res.status(201).json({ ...notice, ...user, photo_url, comment_count: 0, reactions: {} });
  } catch (err) {
    console.error('Create notice error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/notices/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM notices WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notice not found or not yours' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Delete notice error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notices/:id/comments — body: { body }
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
  try {
    const { rows: [comment] } = await pool.query(`
      INSERT INTO notice_comments (notice_id, user_id, body)
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

// DELETE /api/notices/:id/comments/:commentId
router.delete('/:id/comments/:commentId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM notice_comments WHERE id = $1 AND user_id = $2 RETURNING id`,
      [req.params.commentId, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Comment not found or not yours' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/notices/:id/reactions — body: { emoji } — toggles the reaction
router.post('/:id/reactions', requireAuth, async (req, res) => {
  const { emoji } = req.body;
  if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Invalid emoji' });
  try {
    // Try insert; if duplicate, delete instead (toggle)
    const existing = await pool.query(
      'SELECT id FROM notice_reactions WHERE notice_id = $1 AND user_id = $2 AND emoji = $3',
      [req.params.id, req.userId, emoji]
    );
    if (existing.rows.length) {
      await pool.query('DELETE FROM notice_reactions WHERE id = $1', [existing.rows[0].id]);
      res.json({ action: 'removed' });
    } else {
      await pool.query(
        'INSERT INTO notice_reactions (notice_id, user_id, emoji) VALUES ($1, $2, $3)',
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
