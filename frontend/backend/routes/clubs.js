import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// GET /api/clubs/mine — all clubs the authenticated user belongs to
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.code, m.role, m.joined_at,
        (SELECT COUNT(*)::int FROM club_memberships WHERE club_id = c.id) AS member_count
      FROM club_memberships m
      JOIN clubs c ON c.id = m.club_id
      WHERE m.user_id = $1
      ORDER BY m.joined_at DESC
    `, [req.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Get my clubs error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clubs — create a new club
router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Club name is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let code;
    for (let i = 0; i < 10; i++) {
      const candidate = genCode();
      const { rows } = await client.query('SELECT id FROM clubs WHERE code = $1', [candidate]);
      if (!rows.length) { code = candidate; break; }
    }
    if (!code) throw new Error('Could not generate unique club code');

    const { rows: [club] } = await client.query(
      `INSERT INTO clubs (name, code) VALUES ($1, $2) RETURNING id, name, code`,
      [name.trim(), code]
    );

    await client.query(
      `INSERT INTO club_memberships (user_id, club_id, role) VALUES ($1, $2, 'owner')`,
      [req.userId, club.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...club, role: 'owner', member_count: 1 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create club error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// POST /api/clubs/join — join an existing club by code
router.post('/join', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code?.trim()) return res.status(400).json({ error: 'Club code is required' });

  try {
    const { rows } = await pool.query(
      'SELECT id, name, code FROM clubs WHERE code = $1',
      [code.trim().toUpperCase()]
    );
    if (!rows.length) return res.status(404).json({ error: 'No club found with that code' });
    const club = rows[0];

    await pool.query(
      `INSERT INTO club_memberships (user_id, club_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT (user_id, club_id) DO NOTHING`,
      [req.userId, club.id]
    );

    const { rows: [membership] } = await pool.query(
      `SELECT role FROM club_memberships WHERE user_id = $1 AND club_id = $2`,
      [req.userId, club.id]
    );

    const { rows: [{ member_count }] } = await pool.query(
      `SELECT COUNT(*)::int AS member_count FROM club_memberships WHERE club_id = $1`,
      [club.id]
    );

    res.json({ ...club, role: membership.role, member_count });
  } catch (err) {
    console.error('Join club error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id — club detail + caller's role
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.code, c.created_at,
        m.role,
        (SELECT COUNT(*)::int FROM club_memberships WHERE club_id = c.id) AS member_count
      FROM clubs c
      JOIN club_memberships m ON m.club_id = c.id AND m.user_id = $2
      WHERE c.id = $1
    `, [req.params.id, req.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Club not found or not a member' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Get club error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/members — list all members of a club
router.get('/:id/members', requireAuth, async (req, res) => {
  try {
    const access = await pool.query(
      'SELECT id FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Not a member of this club' });

    const { rows } = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.handicap, u.created_at,
        m.role, m.joined_at,
        COUNT(r.id)::int AS rounds_played
      FROM club_memberships m
      JOIN users u ON u.id = m.user_id
      LEFT JOIN rounds r ON r.user_id = u.id AND r.status = 'completed'
      WHERE m.club_id = $1
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.handicap, u.created_at, m.role, m.joined_at
      ORDER BY
        CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,
        u.first_name, u.last_name
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Get club members error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clubs/:id/leave — leave a club
router.delete('/:id/leave', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Leave club error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/leaderboard?season_id=X
router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const access = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Not a member of this club' });

    const { rows: [club] } = await pool.query(
      'SELECT leaderboard_format, leaderboard_n FROM clubs WHERE id = $1',
      [clubId]
    );

    // Resolve season date range
    let startDate, endDate, seasonName, seasonId = null;
    if (req.query.season_id) {
      const { rows: [s] } = await pool.query(
        'SELECT id, name, start_date, end_date FROM seasons WHERE id = $1 AND club_id = $2',
        [req.query.season_id, clubId]
      );
      if (!s) return res.status(404).json({ error: 'Season not found' });
      ({ id: seasonId, name: seasonName, start_date: startDate, end_date: endDate } = s);
    } else {
      const now = new Date().toISOString().split('T')[0];
      const { rows: [active] } = await pool.query(
        `SELECT id, name, start_date, end_date FROM seasons
         WHERE club_id = $1 AND start_date <= $2 AND end_date >= $2
         ORDER BY start_date DESC LIMIT 1`,
        [clubId, now]
      );
      if (active) {
        ({ id: seasonId, name: seasonName, start_date: startDate, end_date: endDate } = active);
      } else {
        const yr = new Date().getFullYear();
        startDate = `${yr}-01-01`;
        endDate   = `${yr}-12-31`;
        seasonName = `${yr} Season`;
      }
    }

    const format = club.leaderboard_format;
    const n      = club.leaderboard_n;
    let rows;

    if (format === 'best_n_scores') {
      const result = await pool.query(`
        WITH season_rounds AS (
          SELECT r.user_id, r.stableford,
            ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.stableford DESC NULLS LAST) AS rn
          FROM rounds r
          JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
          WHERE r.status = 'completed'
            AND r.played_at::date BETWEEN $2::date AND $3::date
            AND r.stableford IS NOT NULL
        ),
        all_rounds AS (
          SELECT r.user_id, COUNT(*)::int AS rounds_played
          FROM rounds r
          JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
          WHERE r.status = 'completed'
            AND r.played_at::date BETWEEN $2::date AND $3::date
          GROUP BY r.user_id
        )
        SELECT
          u.id, u.first_name, u.last_name, u.email, u.handicap,
          COALESCE(ar.rounds_played, 0) AS rounds_played,
          COALESCE(SUM(CASE WHEN sr.rn <= $4 THEN sr.stableford END)::int, 0) AS score_value,
          COUNT(CASE WHEN sr.rn <= $4 THEN 1 END)::int AS scores_counted
        FROM club_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN season_rounds sr ON sr.user_id = m.user_id
        LEFT JOIN all_rounds ar    ON ar.user_id = m.user_id
        WHERE m.club_id = $1
        GROUP BY u.id, u.first_name, u.last_name, u.email, u.handicap, ar.rounds_played
        ORDER BY score_value DESC, rounds_played DESC
      `, [clubId, startDate, endDate, n]);
      rows = result.rows;
    } else {
      // Build aggregate expression from format — only hardcoded strings, no injection risk
      const aggExpr = format === 'average'
        ? 'ROUND(AVG(r.stableford)::numeric, 1)::float'
        : format === 'best_score'
          ? 'MAX(r.stableford)::int'
          : 'SUM(r.stableford)::int'; // total_points (default)

      const result = await pool.query(`
        SELECT
          u.id, u.first_name, u.last_name, u.email, u.handicap,
          COUNT(r.id)::int AS rounds_played,
          COALESCE(${aggExpr}, 0) AS score_value
        FROM club_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN rounds r ON r.user_id = u.id
          AND r.status = 'completed'
          AND r.played_at::date BETWEEN $2::date AND $3::date
          AND r.stableford IS NOT NULL
        WHERE m.club_id = $1
        GROUP BY u.id, u.first_name, u.last_name, u.email, u.handicap
        ORDER BY score_value DESC, rounds_played DESC
      `, [clubId, startDate, endDate]);
      rows = result.rows;
    }

    const formatLabels = {
      total_points: 'Total Points',
      best_n_scores: `Best ${n} Scores`,
      average: 'Average Score',
      best_score: 'Best Score',
    };

    res.json({
      season: { id: seasonId, name: seasonName, start_date: startDate, end_date: endDate },
      format: { type: format, n, label: formatLabels[format] ?? format },
      entries: rows.map((r, i) => ({
        ...r,
        rank: i + 1,
        handicap:    r.handicap    != null ? Number(r.handicap)    : null,
        score_value: Number(r.score_value),
        rounds_played: Number(r.rounds_played),
        scores_counted: r.scores_counted != null ? Number(r.scores_counted) : undefined,
      })),
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clubs/:id/settings — owner updates leaderboard config + group stats toggle
router.patch('/:id/settings', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can change settings' });

    const { leaderboardFormat, leaderboardN, showGroupStats } = req.body;
    const validFormats = ['total_points', 'best_n_scores', 'average', 'best_score'];
    if (leaderboardFormat && !validFormats.includes(leaderboardFormat)) {
      return res.status(400).json({ error: 'Invalid leaderboard format' });
    }
    const n = leaderboardN ? Math.max(1, Math.min(50, parseInt(leaderboardN))) : null;
    const statsFlag = showGroupStats != null ? Boolean(showGroupStats) : null;

    const { rows: [updated] } = await pool.query(`
      UPDATE clubs SET
        leaderboard_format = COALESCE($2, leaderboard_format),
        leaderboard_n      = COALESCE($3, leaderboard_n),
        show_group_stats   = COALESCE($4, show_group_stats)
      WHERE id = $1
      RETURNING leaderboard_format, leaderboard_n, show_group_stats
    `, [clubId, leaderboardFormat ?? null, n, statsFlag]);

    res.json(updated);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/stats — group stats (birdie count, low/high round, highest hole)
router.get('/:id/stats', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const access = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Not a member' });

    const { rows: [club] } = await pool.query(
      'SELECT show_group_stats FROM clubs WHERE id = $1',
      [clubId]
    );

    if (!club.show_group_stats) return res.json({ enabled: false });

    const [birdiesRes, lowRes, highRes, holeRes] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.score <= rh.par - 1
      `, [clubId]),

      pool.query(`
        SELECT u.first_name, u.last_name, u.email, r.score, r.played_at, r.course_name
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND r.score > 0
        ORDER BY r.score ASC LIMIT 1
      `, [clubId]),

      pool.query(`
        SELECT u.first_name, u.last_name, u.email, r.score, r.played_at, r.course_name
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND r.score > 0
        ORDER BY r.score DESC LIMIT 1
      `, [clubId]),

      pool.query(`
        SELECT u.first_name, u.last_name, u.email, rh.hole_number, rh.score, rh.par, r.course_name
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed'
        ORDER BY rh.score DESC LIMIT 1
      `, [clubId]),
    ]);

    res.json({
      enabled:   true,
      birdies:   birdiesRes.rows[0].count,
      lowScore:  lowRes.rows[0]  ?? null,
      highScore: highRes.rows[0] ?? null,
      highHole:  holeRes.rows[0] ?? null,
    });
  } catch (err) {
    console.error('Group stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/seasons
router.get('/:id/seasons', requireAuth, async (req, res) => {
  try {
    const access = await pool.query(
      'SELECT id FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Not a member' });

    const { rows } = await pool.query(
      'SELECT id, name, start_date, end_date FROM seasons WHERE club_id = $1 ORDER BY start_date DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get seasons error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clubs/:id/seasons — owner creates a season
router.post('/:id/seasons', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can create seasons' });

    const { name, startDate, endDate } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Season name is required' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end dates are required' });
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const { rows: [season] } = await pool.query(
      'INSERT INTO seasons (club_id, name, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id, name, start_date, end_date',
      [clubId, name.trim(), startDate, endDate]
    );
    res.status(201).json(season);
  } catch (err) {
    console.error('Create season error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/rules
router.get('/:id/rules', requireAuth, async (req, res) => {
  try {
    const access = await pool.query(
      'SELECT id FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!access.rows.length) return res.status(403).json({ error: 'Not a member' });

    const { rows } = await pool.query(
      'SELECT id, title, body, position, created_at FROM club_rules WHERE club_id = $1 ORDER BY position ASC, created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Get rules error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/clubs/:id/rules — owner adds a rule
router.post('/:id/rules', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can add rules' });

    const { title, body } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Rule text is required' });

    const { rows: [{ max_pos }] } = await pool.query(
      'SELECT COALESCE(MAX(position), 0) AS max_pos FROM club_rules WHERE club_id = $1',
      [clubId]
    );

    const { rows: [rule] } = await pool.query(
      'INSERT INTO club_rules (club_id, title, body, position) VALUES ($1, $2, $3, $4) RETURNING id, title, body, position, created_at',
      [clubId, title?.trim() || null, body.trim(), max_pos + 1]
    );
    res.status(201).json(rule);
  } catch (err) {
    console.error('Add rule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clubs/:id/rules/:ruleId — owner edits a rule
router.patch('/:id/rules/:ruleId', requireAuth, async (req, res) => {
  const { id: clubId, ruleId } = req.params;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can edit rules' });

    const { title, body } = req.body;
    if (body !== undefined && !body?.trim()) return res.status(400).json({ error: 'Rule text cannot be empty' });

    const { rows: [rule] } = await pool.query(`
      UPDATE club_rules SET
        title = COALESCE($3, title),
        body  = COALESCE($4, body)
      WHERE id = $1 AND club_id = $2
      RETURNING id, title, body, position, created_at
    `, [ruleId, clubId, title !== undefined ? (title?.trim() || null) : null, body?.trim() ?? null]);

    if (!rule) return res.status(404).json({ error: 'Rule not found' });
    res.json(rule);
  } catch (err) {
    console.error('Edit rule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clubs/:id/rules/:ruleId — owner deletes a rule
router.delete('/:id/rules/:ruleId', requireAuth, async (req, res) => {
  const { id: clubId, ruleId } = req.params;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can delete rules' });

    const { rowCount } = await pool.query(
      'DELETE FROM club_rules WHERE id = $1 AND club_id = $2',
      [ruleId, clubId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Rule not found' });
    res.json({ deleted: parseInt(ruleId) });
  } catch (err) {
    console.error('Delete rule error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clubs/:id/seasons/:seasonId — owner deletes a season
router.delete('/:id/seasons/:seasonId', requireAuth, async (req, res) => {
  const { id: clubId, seasonId } = req.params;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can delete seasons' });

    const { rowCount } = await pool.query(
      'DELETE FROM seasons WHERE id = $1 AND club_id = $2',
      [seasonId, clubId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Season not found' });
    res.json({ deleted: parseInt(seasonId) });
  } catch (err) {
    console.error('Delete season error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
