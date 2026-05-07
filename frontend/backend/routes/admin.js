import express from 'express';
import pool from '../db/index.js';
import { requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// ── Verify admin password ─────────────────────────────────────────────────────

router.post('/verify', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server' });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ ok: true });
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.handicap, u.is_admin, u.created_at,
        COUNT(r.id)::int AS rounds_played
      FROM users u
      LEFT JOIN rounds r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY u.first_name NULLS LAST, u.last_name NULLS LAST, u.email
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin list users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
  const { handicap, isAdmin } = req.body;

  if (handicap !== undefined && handicap !== null) {
    const h = parseFloat(handicap);
    if (isNaN(h) || h < -10 || h > 54) {
      return res.status(400).json({ error: 'Handicap must be between -10 and 54' });
    }
  }

  try {
    const { rows } = await pool.query(`
      UPDATE users
      SET
        handicap   = CASE WHEN $1::text IS NOT NULL THEN $1::decimal ELSE handicap END,
        is_admin   = CASE WHEN $2::text IS NOT NULL THEN $2::boolean ELSE is_admin END,
        updated_at = NOW()
      WHERE id = $3
      RETURNING id, email, first_name, last_name, handicap, is_admin, created_at
    `, [
      handicap != null ? String(handicap) : null,
      isAdmin  != null ? String(isAdmin)  : null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Rounds ────────────────────────────────────────────────────────────────────

router.get('/rounds', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.played_at, r.course_name, r.score, r.stableford, r.notes, r.created_at,
        u.id AS user_id, u.email, u.first_name, u.last_name
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      ORDER BY r.played_at DESC, r.created_at DESC
      LIMIT 500
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin list rounds:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/rounds/:id', requireAdmin, async (req, res) => {
  const { playedAt, courseName, score, stableford, notes } = req.body;

  if (score !== undefined && score !== null) {
    const s = parseInt(score);
    if (isNaN(s) || s < 18 || s > 200) {
      return res.status(400).json({ error: 'Score must be a realistic number of strokes' });
    }
  }

  try {
    const { rows } = await pool.query(`
      UPDATE rounds
      SET
        played_at   = COALESCE($1::date,    played_at),
        course_name = COALESCE($2,          course_name),
        score       = COALESCE($3::int,     score),
        stableford  = COALESCE($4::int,     stableford),
        notes       = $5
      WHERE id = $6
      RETURNING id, played_at, course_name, score, stableford, notes, user_id
    `, [
      playedAt    || null,
      courseName?.trim() || null,
      score      != null ? parseInt(score)      : null,
      stableford != null ? parseInt(stableford) : null,
      notes?.trim() || null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Round not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin edit round:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/rounds/:id', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM rounds WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Round not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin delete round:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Season ────────────────────────────────────────────────────────────────────

router.get('/season', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE key IN ('season_name','season_start','season_end')"
    );
    const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
    res.json({ name: s.season_name ?? 'Current Season', start: s.season_start ?? null, end: s.season_end ?? null });
  } catch (err) {
    console.error('Get season:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/season', requireAdmin, async (req, res) => {
  const { name, start, end } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Season name is required' });
  try {
    await pool.query(`
      INSERT INTO settings (key, value, updated_at) VALUES
        ('season_name',  $1, NOW()),
        ('season_start', $2, NOW()),
        ('season_end',   $3, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `, [name.trim(), start || null, end || null]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update season:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
