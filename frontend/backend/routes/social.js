import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_ROUND_EMOJIS = ['👍', '❤️', '🔥', '😮'];

async function roundReactionSummary(roundIds, userId) {
  if (!roundIds.length) return {};
  const { rows } = await pool.query(
    `SELECT round_id, emoji, COUNT(*)::int AS count,
            bool_or(user_id = $2) AS reacted
     FROM round_reactions
     WHERE round_id = ANY($1::uuid[])
     GROUP BY round_id, emoji`,
    [roundIds, userId]
  );
  const map = {};
  for (const r of rows) {
    if (!map[r.round_id]) map[r.round_id] = {};
    map[r.round_id][r.emoji] = { count: r.count, reacted: r.reacted };
  }
  return map;
}

// ── Season helpers ────────────────────────────────────────────────────────────

async function getSeason() {
  const { rows } = await pool.query(
    "SELECT key, value FROM settings WHERE key IN ('season_name','season_start','season_end')"
  );
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    name:  s.season_name  ?? 'Current Season',
    start: s.season_start ?? null,
    end:   s.season_end   ?? null,
  };
}

// GET /api/social/season
router.get('/season', requireAuth, async (req, res) => {
  try {
    res.json(await getSeason());
  } catch (err) {
    console.error('Season error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/leaderboard?club_id=X — ranked by average of best 6 rounds in season
router.get('/leaderboard', requireAuth, async (req, res) => {
  try {
    const { start, end } = await getSeason();
    const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;

    const { rows } = await pool.query(`
      WITH season_rounds AS (
        SELECT r.id, r.user_id, r.stableford, r.score
        FROM rounds r
        WHERE r.status = 'completed'
          AND ($1::date IS NULL OR r.played_at >= $1::date)
          AND ($2::date IS NULL OR r.played_at <= $2::date)
          AND ($3::int IS NULL OR r.user_id IN (
            SELECT user_id FROM club_memberships WHERE club_id = $3
          ))
      ),
      best6_avg AS (
        SELECT user_id,
          ROUND(AVG(stableford)::numeric, 1)::float AS avg_stableford,
          COUNT(*)::int AS rounds_used
        FROM (
          SELECT user_id, stableford,
            ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY stableford DESC) AS rn
          FROM season_rounds
        ) ranked
        WHERE rn <= 6
        GROUP BY user_id
      )
      SELECT
        u.id, u.first_name, u.last_name, u.email, u.handicap,
        COUNT(sr.id)::int       AS rounds_played,
        b.rounds_used,
        b.avg_stableford,
        MAX(sr.stableford)::int AS best_stableford,
        MIN(sr.score)::int      AS best_score
      FROM users u
      JOIN season_rounds sr ON sr.user_id = u.id
      JOIN best6_avg b       ON b.user_id  = u.id
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.handicap,
               b.avg_stableford, b.rounds_used
      ORDER BY b.avg_stableford DESC NULLS LAST
    `, [start, end, clubId]);

    res.json(rows);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/birdies?club_id=X
router.get('/birdies', requireAuth, async (req, res) => {
  try {
    const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email,
        COUNT(CASE WHEN rh.score = rh.par - 1 THEN 1 END)::int  AS birdies,
        COUNT(CASE WHEN rh.score <= rh.par - 2 THEN 1 END)::int AS eagles_plus,
        COUNT(CASE WHEN rh.score <= rh.par - 1 THEN 1 END)::int AS total
      FROM users u
      JOIN rounds r ON r.user_id = u.id
      JOIN round_holes rh ON rh.round_id = r.id
      WHERE ($1::int IS NULL OR u.id IN (
        SELECT user_id FROM club_memberships WHERE club_id = $1
      ))
      GROUP BY u.id
      HAVING COUNT(CASE WHEN rh.score <= rh.par - 1 THEN 1 END) > 0
      ORDER BY total DESC, eagles_plus DESC
    `, [clubId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Birdies error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/best-rounds?club_id=X
router.get('/best-rounds', requireAuth, async (req, res) => {
  try {
    const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
    const result = await pool.query(`
      SELECT r.id, r.course_name, r.played_at, r.score, r.stableford,
        u.first_name, u.last_name, u.email, u.id AS user_id
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      WHERE r.status = 'completed'
        AND ($1::int IS NULL OR u.id IN (
          SELECT user_id FROM club_memberships WHERE club_id = $1
        ))
      ORDER BY r.stableford DESC, r.score ASC
      LIMIT 10
    `, [clubId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Best rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/social/feed?club_id=X
router.get('/feed', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.played_at, r.course_name, r.score, r.stableford,
             r.photo_data, r.round_type, r.created_at,
             u.id AS user_id, u.first_name, u.last_name, u.email,
             (SELECT COUNT(*)::int FROM round_comments WHERE round_id = r.id) AS comment_count
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      WHERE r.status = 'completed'
        AND ($1::int IS NULL OR u.id IN (
          SELECT user_id FROM club_memberships WHERE club_id = $1
        ))
      ORDER BY r.created_at DESC
      LIMIT 50
    `, [clubId]);
    const ids = rows.map(r => r.id);
    const reactions = await roundReactionSummary(ids, req.userId);
    res.json(rows.map(r => ({ ...r, reactions: reactions[r.id] || {} })));
  } catch (err) {
    console.error('Feed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
