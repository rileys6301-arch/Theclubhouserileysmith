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

// GET /api/clubs/mine/members — all unique members from all clubs the user belongs to
router.get('/mine/members', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (u.id) u.id, u.first_name, u.last_name, u.email, u.handicap
      FROM club_memberships m1
      JOIN club_memberships m2 ON m2.club_id = m1.club_id AND m2.user_id != $1
      JOIN users u ON u.id = m2.user_id
      WHERE m1.user_id = $1
      ORDER BY u.id, u.first_name NULLS LAST, u.last_name NULLS LAST
    `, [req.userId]);
    res.json(rows);
  } catch (err) {
    console.error('Mine members error:', err);
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

// GET /api/clubs/:id — club detail + caller's role + settings
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.code, c.created_at,
        c.leaderboard_format, c.leaderboard_n, c.show_group_stats,
        c.include_tournaments, c.include_scoring, c.include_social,
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

// PATCH /api/clubs/:id/members/:userId/role — owner sets a member's role (admin|member)
router.patch('/:id/members/:userId/role', requireAuth, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or member' });
  }
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (caller?.role !== 'owner') return res.status(403).json({ error: 'Only owners can change roles' });

    const { rows: [target] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    if (!target) return res.status(404).json({ error: 'Member not found' });
    if (target.role === 'owner') return res.status(400).json({ error: 'Cannot change the owner\'s role' });

    await pool.query(
      'UPDATE club_memberships SET role = $1 WHERE club_id = $2 AND user_id = $3',
      [role, req.params.id, req.params.userId]
    );
    res.json({ ok: true, role });
  } catch (err) {
    console.error('Set member role error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clubs/:id — owner permanently deletes the club
router.delete('/:id', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete this club' });

    const { rowCount } = await pool.query('DELETE FROM clubs WHERE id = $1', [clubId]);
    if (!rowCount) return res.status(404).json({ error: 'Club not found' });

    res.json({ deleted: clubId });
  } catch (err) {
    console.error('Delete club error:', err);
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
      'SELECT leaderboard_format, leaderboard_n, include_tournaments, include_scoring, include_social FROM clubs WHERE id = $1',
      [clubId]
    );

    const typeConditions = [];
    if (club.include_tournaments) typeConditions.push("r.competition_id IS NOT NULL");
    if (club.include_scoring)     typeConditions.push("(r.competition_id IS NULL AND COALESCE(r.round_type,'social') = 'scoring')");
    if (club.include_social)      typeConditions.push("(r.competition_id IS NULL AND COALESCE(r.round_type,'social') = 'social')");
    // If all three enabled (or all disabled), no filter — show everything
    const roundTypeFilter = typeConditions.length > 0 && typeConditions.length < 3
      ? `AND (${typeConditions.join(' OR ')})`
      : '';

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
            ${roundTypeFilter}
        ),
        all_rounds AS (
          SELECT r.user_id, COUNT(*)::int AS rounds_played
          FROM rounds r
          JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
          WHERE r.status = 'completed'
            AND r.played_at::date BETWEEN $2::date AND $3::date
            ${roundTypeFilter}
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
          ${roundTypeFilter}
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

    const { leaderboardFormat, leaderboardN, showGroupStats,
            includeTournaments, includeScoring, includeSocial } = req.body;
    const validFormats = ['total_points', 'best_n_scores', 'average', 'best_score'];
    if (leaderboardFormat && !validFormats.includes(leaderboardFormat)) {
      return res.status(400).json({ error: 'Invalid leaderboard format' });
    }
    const n          = leaderboardN  != null ? Math.max(1, Math.min(50, parseInt(leaderboardN))) : null;
    const statsFlag  = showGroupStats    != null ? Boolean(showGroupStats)    : null;
    const incTourney = includeTournaments != null ? Boolean(includeTournaments) : null;
    const incScoring = includeScoring     != null ? Boolean(includeScoring)     : null;
    const incSocial  = includeSocial      != null ? Boolean(includeSocial)      : null;

    const { rows: [updated] } = await pool.query(`
      UPDATE clubs SET
        leaderboard_format  = COALESCE($2, leaderboard_format),
        leaderboard_n       = COALESCE($3, leaderboard_n),
        show_group_stats    = COALESCE($4, show_group_stats),
        include_tournaments = COALESCE($5, include_tournaments),
        include_scoring     = COALESCE($6, include_scoring),
        include_social      = COALESCE($7, include_social)
      WHERE id = $1
      RETURNING leaderboard_format, leaderboard_n, show_group_stats,
                include_tournaments, include_scoring, include_social
    `, [clubId, leaderboardFormat ?? null, n, statsFlag, incTourney, incScoring, incSocial]);

    res.json(updated);
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clubs/:id/name — owner renames the club
router.patch('/:id/name', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [m] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!m || m.role !== 'owner') return res.status(403).json({ error: 'Only owners can rename the club' });

    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Club name is required' });
    if (name.trim().length > 60) return res.status(400).json({ error: 'Name must be 60 characters or fewer' });

    const { rows: [updated] } = await pool.query(
      'UPDATE clubs SET name = $1 WHERE id = $2 RETURNING name',
      [name.trim(), clubId]
    );
    res.json(updated);
  } catch (err) {
    console.error('Rename club error:', err);
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

// PATCH /api/clubs/:id/admin/members/:userId/handicap — owner or admin sets a member's handicap
router.patch('/:id/admin/members/:userId/handicap', requireAuth, async (req, res) => {
  const { id: clubId, userId: targetId } = req.params;
  const { handicap } = req.body;
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const { rows: [target] } = await pool.query(
      'SELECT id FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, targetId]
    );
    if (!target) return res.status(404).json({ error: 'Member not found in this club' });

    const h = handicap != null ? parseFloat(handicap) : null;
    if (h != null && (isNaN(h) || h < -10 || h > 54)) {
      return res.status(400).json({ error: 'Handicap must be between -10 and 54' });
    }
    const { rows: [updated] } = await pool.query(
      'UPDATE users SET handicap = $1, updated_at = NOW() WHERE id = $2 RETURNING id, handicap',
      [h, targetId]
    );
    res.json(updated);
  } catch (err) {
    console.error('Admin set handicap error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/admin/rounds — owner or admin lists all member rounds
router.get('/:id/admin/rounds', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const { rows } = await pool.query(`
      SELECT r.id, r.played_at, r.course_name, r.score, r.stableford, r.notes, r.created_at,
        u.id AS user_id, u.first_name, u.last_name, u.email
      FROM rounds r
      JOIN users u ON u.id = r.user_id
      JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
      WHERE r.status = 'completed'
      ORDER BY r.played_at DESC, r.created_at DESC
      LIMIT 500
    `, [clubId]);
    res.json(rows);
  } catch (err) {
    console.error('Club admin rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/clubs/:id/admin/rounds/:roundId — owner or admin deletes any member's round
router.delete('/:id/admin/rounds/:roundId', requireAuth, async (req, res) => {
  const { id: clubId, roundId } = req.params;
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const { rows } = await pool.query(`
      DELETE FROM rounds
      WHERE id = $1
        AND user_id IN (SELECT user_id FROM club_memberships WHERE club_id = $2)
      RETURNING id
    `, [roundId, clubId]);
    if (!rows.length) return res.status(404).json({ error: 'Round not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Club admin delete round error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/clubs/:id/admin/rounds/:roundId/holes — fetch hole-by-hole data for a round
router.get('/:id/admin/rounds/:roundId/holes', requireAuth, async (req, res) => {
  const { id: clubId, roundId } = req.params;
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    // Verify the round belongs to a club member
    const { rows: [round] } = await pool.query(`
      SELECT r.id, r.course_handicap
      FROM rounds r
      JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
      WHERE r.id = $2 AND r.status = 'completed'
    `, [clubId, roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    const { rows: holes } = await pool.query(`
      SELECT hole_number, par, stroke_index, score, stableford_points
      FROM round_holes WHERE round_id = $1 ORDER BY hole_number
    `, [roundId]);
    res.json({ courseHandicap: round.course_handicap, holes });
  } catch (err) {
    console.error('Admin get holes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clubs/:id/admin/rounds/:roundId/holes — admin edits hole scores and recalculates totals
router.patch('/:id/admin/rounds/:roundId/holes', requireAuth, async (req, res) => {
  const { id: clubId, roundId } = req.params;
  const { holes } = req.body; // [{ holeNumber, score }]
  if (!Array.isArray(holes) || !holes.length) {
    return res.status(400).json({ error: 'holes array required' });
  }
  try {
    const { rows: [caller] } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!caller || !['owner', 'admin'].includes(caller.role)) {
      return res.status(403).json({ error: 'Not authorised' });
    }
    const { rows: [round] } = await pool.query(`
      SELECT r.id, r.course_handicap
      FROM rounds r
      JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
      WHERE r.id = $2 AND r.status = 'completed'
    `, [clubId, roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const ph = round.course_handicap ?? 0;

    // Fetch existing hole data to keep par/si for untouched holes
    const { rows: existing } = await pool.query(
      `SELECT hole_number, par, stroke_index FROM round_holes WHERE round_id = $1`,
      [roundId]
    );
    const holeInfo = Object.fromEntries(existing.map(h => [h.hole_number, h]));

    // Build update map from request
    const updateMap = Object.fromEntries(holes.map(h => [h.holeNumber, h.score]));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [holeNumStr, newScore] of Object.entries(updateMap)) {
        const holeNum = parseInt(holeNumStr);
        const info = holeInfo[holeNum];
        if (!info) continue;
        const par = info.par ?? 4;
        const si  = info.stroke_index ?? holeNum;
        // Recalculate stableford: shots received = floor(ph / 18) + (si <= ph % 18 ? 1 : 0)
        const shotsReceived = Math.floor(ph / 18) + (si <= (ph % 18) ? 1 : 0);
        const netScore = newScore - shotsReceived;
        const stableford = Math.max(0, par - netScore + 2);
        await client.query(`
          UPDATE round_holes
          SET score = $1, stableford_points = $2
          WHERE round_id = $3 AND hole_number = $4
        `, [newScore, stableford, roundId, holeNum]);
      }
      // Recalculate round totals
      const { rows: [totals] } = await client.query(`
        SELECT COALESCE(SUM(score), 0)::int            AS total_score,
               COALESCE(SUM(stableford_points), 0)::int AS total_stableford
        FROM round_holes WHERE round_id = $1
      `, [roundId]);
      await client.query(
        `UPDATE rounds SET score = $1, stableford = $2 WHERE id = $3`,
        [totals.total_score, totals.total_stableford, roundId]
      );
      await client.query('COMMIT');
      res.json({ score: totals.total_score, stableford: totals.total_stableford });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Admin edit holes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Backfill round_holes for tournament rounds that were logged without hole data.
// Called once before Hall queries — cheap after the first run (NOT EXISTS is fast).
async function backfillTournamentHoles(pool, clubId) {
  try {
    // Find tournament rounds for this club's members that have no round_holes yet
    const { rows: toFill } = await pool.query(`
      SELECT r.id AS round_id, r.user_id, r.competition_id, c.hole_data
      FROM rounds r
      JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
      JOIN competitions c ON c.id = r.competition_id
      WHERE r.competition_id IS NOT NULL
        AND r.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM round_holes WHERE round_id = r.id)
      LIMIT 200
    `, [clubId]);

    for (const r of toFill) {
      const holeInfoArr = Array.isArray(r.hole_data) ? r.hole_data : null;
      const holeMap = new Map((holeInfoArr || []).map(h => [h.number, h]));

      const { rows: holeScores } = await pool.query(`
        SELECT
          hole_number,
          COALESCE(
            MAX(CASE WHEN submitted_by != $2 THEN score END),
            MAX(CASE WHEN submitted_by  = $2 THEN score END)
          )::int AS score,
          COALESCE(
            MAX(CASE WHEN submitted_by != $2 THEN stableford_points END),
            MAX(CASE WHEN submitted_by  = $2 THEN stableford_points END)
          )::int AS stableford_points,
          COALESCE(
            MAX(CASE WHEN submitted_by != $2 THEN fairway_hit::int END),
            MAX(CASE WHEN submitted_by  = $2 THEN fairway_hit::int END)
          ) AS fairway_hit_int,
          COALESCE(
            MAX(CASE WHEN submitted_by != $2 THEN gir::int END),
            MAX(CASE WHEN submitted_by  = $2 THEN gir::int END)
          ) AS gir_int,
          COALESCE(
            MAX(CASE WHEN submitted_by != $2 THEN putts END),
            MAX(CASE WHEN submitted_by  = $2 THEN putts END)
          ) AS putts
        FROM competition_scores
        WHERE competition_id = $1 AND player_id = $2
        GROUP BY hole_number
        ORDER BY hole_number
      `, [r.competition_id, r.user_id]);

      for (const h of holeScores) {
        const hInfo = holeMap.get(h.hole_number);
        const fairwayHit = h.fairway_hit_int != null ? h.fairway_hit_int === 1 : null;
        const gir        = h.gir_int        != null ? h.gir_int        === 1 : null;
        await pool.query(`
          INSERT INTO round_holes
            (round_id, hole_number, par, stroke_index, score, stableford_points, fairway_hit, gir, putts)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (round_id, hole_number) DO NOTHING
        `, [
          r.round_id,
          h.hole_number,
          hInfo?.par ?? 4,
          hInfo?.si  ?? h.hole_number,
          h.score,
          h.stableford_points,
          fairwayHit,
          gir,
          h.putts ?? null,
        ]);
      }
    }
  } catch (err) {
    // Backfill is best-effort — don't block the hall response
    console.error('Hall backfill error:', err);
  }
}

// GET /api/clubs/:id/hall — hall of fame & hall of shame records
router.get('/:id/hall', requireAuth, async (req, res) => {
  const clubId = req.params.id;
  try {
    const { rows: access } = await pool.query(
      'SELECT role FROM club_memberships WHERE club_id = $1 AND user_id = $2',
      [clubId, req.userId]
    );
    if (!access.length) return res.status(403).json({ error: 'Not a member' });

    // Retroactively populate round_holes for any tournament rounds missing it
    await backfillTournamentHoles(pool, clubId);

    const [
      lowRoundsRes,
      highRoundsRes,
      bestStablefordRes,
      mostBirdiesRes,
      mostEaglesRes,
      holesInOneRes,
      worstHoleRes,
      bigNumbersRes,
      bestFIRRes,
      worstFIRRes,
      bestGIRRes,
      worstGIRRes,
      fewestPuttsRes,
      mostPuttsRes,
    ] = await Promise.all([

      // Top 5 best score-to-par rounds (Hall of Fame)
      // Only includes rounds with full hole data so course par can be derived
      pool.query(`
        SELECT u.first_name, u.last_name, u.email,
               r.score, r.stableford, r.played_at, r.course_name,
               SUM(rh.par)::int AS course_par,
               (r.score - SUM(rh.par)::int) AS score_to_par
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        JOIN round_holes rh ON rh.round_id = r.id
        WHERE r.status = 'completed' AND r.score > 0
        GROUP BY r.id, u.id, u.first_name, u.last_name, u.email,
                 r.score, r.stableford, r.played_at, r.course_name
        ORDER BY score_to_par ASC LIMIT 5
      `, [clubId]),

      // Top 5 worst score-to-par rounds (Hall of Shame)
      pool.query(`
        SELECT u.first_name, u.last_name, u.email,
               r.score, r.stableford, r.played_at, r.course_name,
               SUM(rh.par)::int AS course_par,
               (r.score - SUM(rh.par)::int) AS score_to_par
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        JOIN round_holes rh ON rh.round_id = r.id
        WHERE r.status = 'completed' AND r.score > 0
        GROUP BY r.id, u.id, u.first_name, u.last_name, u.email,
                 r.score, r.stableford, r.played_at, r.course_name
        ORDER BY score_to_par DESC LIMIT 5
      `, [clubId]),

      // Best stableford round ever
      pool.query(`
        SELECT u.first_name, u.last_name, u.email,
               r.score, r.stableford, r.played_at, r.course_name
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND r.stableford IS NOT NULL
        ORDER BY r.stableford DESC LIMIT 1
      `, [clubId]),

      // Most birdies (score exactly par - 1)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               COUNT(*)::int AS count
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.score = rh.par - 1
        GROUP BY u.id, u.first_name, u.last_name, u.email
        ORDER BY count DESC LIMIT 5
      `, [clubId]),

      // Most eagles (score <= par - 2)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               COUNT(*)::int AS count
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.score <= rh.par - 2
        GROUP BY u.id, u.first_name, u.last_name, u.email
        ORDER BY count DESC LIMIT 5
      `, [clubId]),

      // Holes in one (score = 1)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               COUNT(*)::int AS count
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.score = 1
        GROUP BY u.id, u.first_name, u.last_name, u.email
        ORDER BY count DESC LIMIT 5
      `, [clubId]),

      // Worst single hole ever (most over par)
      pool.query(`
        SELECT u.first_name, u.last_name, u.email,
               rh.hole_number, rh.score, rh.par, r.course_name,
               (rh.score - rh.par) AS over_par
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.par IS NOT NULL AND rh.score > 0
        ORDER BY (rh.score - rh.par) DESC LIMIT 1
      `, [clubId]),

      // Most triple bogeys or worse (score >= par + 3)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               COUNT(*)::int AS count
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.score >= rh.par + 3
        GROUP BY u.id, u.first_name, u.last_name, u.email
        ORDER BY count DESC LIMIT 5
      `, [clubId]),

      // Best fairway hit % (par 4 + 5 only, min 9 tracked holes)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(100.0 * COUNT(*) FILTER (WHERE rh.fairway_hit = true)
                 / NULLIF(COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL), 0), 1)::float AS value
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.par IN (4, 5) AND rh.fairway_hit IS NOT NULL
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL) >= 9
        ORDER BY value DESC LIMIT 5
      `, [clubId]),

      // Worst fairway hit %
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(100.0 * COUNT(*) FILTER (WHERE rh.fairway_hit = true)
                 / NULLIF(COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL), 0), 1)::float AS value
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.par IN (4, 5) AND rh.fairway_hit IS NOT NULL
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL) >= 9
        ORDER BY value ASC LIMIT 5
      `, [clubId]),

      // Best GIR % (min 9 tracked holes)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(100.0 * COUNT(*) FILTER (WHERE rh.gir = true)
                 / NULLIF(COUNT(*) FILTER (WHERE rh.gir IS NOT NULL), 0), 1)::float AS value
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.gir IS NOT NULL
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) FILTER (WHERE rh.gir IS NOT NULL) >= 9
        ORDER BY value DESC LIMIT 5
      `, [clubId]),

      // Worst GIR %
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(100.0 * COUNT(*) FILTER (WHERE rh.gir = true)
                 / NULLIF(COUNT(*) FILTER (WHERE rh.gir IS NOT NULL), 0), 1)::float AS value
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed' AND rh.gir IS NOT NULL
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) FILTER (WHERE rh.gir IS NOT NULL) >= 9
        ORDER BY value ASC LIMIT 5
      `, [clubId]),

      // Fewest putts per round avg (min 1 complete 18-hole round with putts)
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(AVG(round_putts)::numeric, 1)::float AS value
        FROM (
          SELECT r.user_id, SUM(rh.putts)::int AS round_putts
          FROM round_holes rh
          JOIN rounds r ON r.id = rh.round_id
          JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
          WHERE r.status = 'completed' AND rh.putts IS NOT NULL
          GROUP BY r.id, r.user_id
          HAVING COUNT(rh.id) = 18
        ) per_round
        JOIN users u ON u.id = per_round.user_id
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) >= 1
        ORDER BY value ASC LIMIT 5
      `, [clubId]),

      // Most putts per round avg
      pool.query(`
        SELECT u.id, u.first_name, u.last_name, u.email,
               ROUND(AVG(round_putts)::numeric, 1)::float AS value
        FROM (
          SELECT r.user_id, SUM(rh.putts)::int AS round_putts
          FROM round_holes rh
          JOIN rounds r ON r.id = rh.round_id
          JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
          WHERE r.status = 'completed' AND rh.putts IS NOT NULL
          GROUP BY r.id, r.user_id
          HAVING COUNT(rh.id) = 18
        ) per_round
        JOIN users u ON u.id = per_round.user_id
        GROUP BY u.id, u.first_name, u.last_name, u.email
        HAVING COUNT(*) >= 1
        ORDER BY value DESC LIMIT 5
      `, [clubId]),
    ]);

    res.json({
      fame: {
        lowRounds:      lowRoundsRes.rows,
        bestStableford: bestStablefordRes.rows[0] ?? null,
        mostBirdies:    mostBirdiesRes.rows,
        mostEagles:     mostEaglesRes.rows,
        holesInOne:     holesInOneRes.rows,
        bestFIR:        bestFIRRes.rows,
        bestGIR:        bestGIRRes.rows,
        fewestPutts:    fewestPuttsRes.rows,
      },
      shame: {
        highRounds:  highRoundsRes.rows,
        worstHole:   worstHoleRes.rows[0] ?? null,
        bigNumbers:  bigNumbersRes.rows,
        worstFIR:    worstFIRRes.rows,
        worstGIR:    worstGIRRes.rows,
        mostPutts:   mostPuttsRes.rows,
      },
    });
  } catch (err) {
    console.error('Hall of fame error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Monthly club stats ────────────────────────────────────────────────────────

router.get('/:id/monthly-stats', requireAuth, async (req, res) => {
  const clubId = parseInt(req.params.id);
  if (!clubId) return res.status(400).json({ error: 'Invalid club id' });

  // Client passes local-date range so we avoid UTC/AEST boundary issues
  const { start, end } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end date params required' });
  }

  try {
    const [grossRes, netRes, stablefordRes, improvedRes] = await Promise.all([

      // Lowest gross stroke this month (top 3)
      pool.query(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
               r.score, r.course_name, r.played_at
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed'
          AND r.score IS NOT NULL AND r.score > 0
          AND r.played_at::date BETWEEN $2::date AND $3::date
        ORDER BY r.score ASC
        LIMIT 3
      `, [clubId, start, end]),

      // Lowest net stroke this month — score minus handicap_index (top 3)
      pool.query(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
               r.score, r.handicap_index,
               (r.score - ROUND(r.handicap_index)::int) AS net_score,
               r.course_name, r.played_at
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed'
          AND r.score IS NOT NULL AND r.score > 0
          AND r.handicap_index IS NOT NULL
          AND r.played_at::date BETWEEN $2::date AND $3::date
        ORDER BY net_score ASC
        LIMIT 3
      `, [clubId, start, end]),

      // Highest stableford this month (top 3)
      pool.query(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
               r.stableford, r.course_name, r.played_at
        FROM rounds r
        JOIN users u ON u.id = r.user_id
        JOIN club_memberships m ON m.user_id = r.user_id AND m.club_id = $1
        WHERE r.status = 'completed'
          AND r.stableford IS NOT NULL AND r.stableford > 0
          AND r.played_at::date BETWEEN $2::date AND $3::date
        ORDER BY r.stableford DESC
        LIMIT 3
      `, [clubId, start, end]),

      // Biggest handicap drop this month (most improved)
      pool.query(`
        SELECT u.id AS user_id, u.first_name, u.last_name, u.email,
               u.handicap AS current_handicap,
               first_r.handicap_index AS month_start_hcp,
               last_r.handicap_index  AS month_end_hcp,
               ROUND((first_r.handicap_index - last_r.handicap_index)::numeric, 1) AS handicap_drop
        FROM users u
        JOIN club_memberships m ON m.user_id = u.id AND m.club_id = $1
        JOIN LATERAL (
          SELECT handicap_index FROM rounds
          WHERE user_id = u.id AND status = 'completed' AND handicap_index IS NOT NULL
            AND played_at::date BETWEEN $2::date AND $3::date
          ORDER BY played_at ASC LIMIT 1
        ) first_r ON true
        JOIN LATERAL (
          SELECT handicap_index FROM rounds
          WHERE user_id = u.id AND status = 'completed' AND handicap_index IS NOT NULL
            AND played_at::date BETWEEN $2::date AND $3::date
          ORDER BY played_at DESC LIMIT 1
        ) last_r ON true
        WHERE first_r.handicap_index > last_r.handicap_index
        ORDER BY handicap_drop DESC
        LIMIT 5
      `, [clubId, start, end]),
    ]);

    res.json({
      lowest_gross:       grossRes.rows,
      lowest_net:         netRes.rows,
      highest_stableford: stablefordRes.rows,
      most_improved:      improvedRes.rows,
    });
  } catch (err) {
    console.error('Monthly stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
