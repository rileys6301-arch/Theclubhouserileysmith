import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Shared filter for stats endpoints: ?limit=N (N most recent completed rounds)
// or ?season=current (rounds played in the current calendar year). Mutually
// exclusive — limit wins if both are given. Returns null if limit is invalid.
function parseStatsFilter(req) {
  const { limit, season } = req.query;
  if (limit != null) {
    const n = parseInt(limit, 10);
    if (isNaN(n) || n < 1) return null;
    return { limit: n, season: false };
  }
  return { limit: null, season: season === 'current' };
}

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, handicap, is_admin, club_name, club_code, club_role, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
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

// POST /api/users/push-token — register or update device push token
router.post('/push-token', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token required' });
  }
  try {
    await pool.query(
      'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2',
      [token, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Push token error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/users/me — permanently delete account and all data
router.delete('/me', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);
    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id — public profile for one user
router.get('/:id', requireAuth, async (req, res) => {
  const filter = parseStatsFilter(req);
  if (!filter) return res.status(400).json({ error: 'limit must be a positive integer' });

  const params = [req.params.id, req.userId];
  const seasonClause = filter.season ? "AND EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW())" : '';
  let limitClause = '';
  if (filter.limit) {
    params.push(filter.limit);
    limitClause = `AND r.id IN (
          SELECT id FROM rounds WHERE user_id = $1 AND status = 'completed'
            ${filter.season ? "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW())" : ''}
          ORDER BY played_at DESC, created_at DESC LIMIT $${params.length}
        )`;
  }

  try {
    const result = await pool.query(`
      SELECT
        u.id, u.email, u.first_name, u.last_name, u.handicap, u.created_at,
        -- round-level aggregates
        COALESCE(rs.rounds_played, 0)::int         AS rounds_played,
        rs.avg_stableford,
        rs.best_stableford,
        rs.best_score,
        rs.avg_score,
        rs.avg_vs_par,
        rs.unique_courses,
        rs.last_played_at,
        rs.last_score,
        rs.last_stableford,
        rs.rounds_this_year,
        rs.rounds_last_year,
        -- hole-level aggregates
        COALESCE(hs.total_eagles_plus, 0)::int     AS total_eagles_plus,
        COALESCE(hs.total_birdies, 0)::int         AS total_birdies,
        COALESCE(hs.total_pars, 0)::int            AS total_pars,
        COALESCE(hs.total_bogeys, 0)::int          AS total_bogeys,
        COALESCE(hs.total_double_plus, 0)::int     AS total_double_plus,
        COALESCE(hs.total_holes, 0)::int           AS total_holes,
        hs.points_per_hole,
        -- club average handicap across clubs shared by viewer and target
        cavg.club_avg_handicap
      FROM users u
      LEFT JOIN (
        SELECT ROUND(AVG(u2.handicap)::numeric, 1)::float AS club_avg_handicap
        FROM club_memberships m_target
        JOIN club_memberships m_viewer ON m_viewer.club_id = m_target.club_id AND m_viewer.user_id = $2
        JOIN club_memberships m_all    ON m_all.club_id    = m_target.club_id
        JOIN users u2 ON u2.id = m_all.user_id AND u2.handicap IS NOT NULL
        WHERE m_target.user_id = $1
      ) cavg ON true
      LEFT JOIN (
        SELECT r.user_id,
          COUNT(*)::int                                                                         AS rounds_played,
          ROUND(AVG(r.stableford)::numeric, 1)::float                                          AS avg_stableford,
          MAX(r.stableford)::int                                                                AS best_stableford,
          MIN(r.score)::int                                                                     AS best_score,
          ROUND(AVG(r.score)::numeric, 1)::float                                               AS avg_score,
          -- Use actual course par from hole data where available, fall back to 72
          ROUND(AVG(r.score - COALESCE(rp.course_par, 72))::numeric, 1)::float                AS avg_vs_par,
          COUNT(DISTINCT r.course_name)::int                                                    AS unique_courses,
          MAX(r.played_at)::text                                                                AS last_played_at,
          (ARRAY_AGG(r.score      ORDER BY r.played_at DESC, r.created_at DESC))[1]::int       AS last_score,
          (ARRAY_AGG(r.stableford ORDER BY r.played_at DESC, r.created_at DESC))[1]::int       AS last_stableford,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW()))::int      AS rounds_this_year,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW()) - 1)::int AS rounds_last_year
        FROM rounds r
        LEFT JOIN (
          SELECT round_id, SUM(par)::int AS course_par
          FROM round_holes
          GROUP BY round_id
        ) rp ON rp.round_id = r.id
        WHERE r.user_id = $1 AND r.status = 'completed' ${seasonClause} ${limitClause}
        GROUP BY r.user_id
      ) rs ON rs.user_id = u.id
      LEFT JOIN (
        SELECT r.user_id,
          COUNT(rh.id) FILTER (WHERE rh.score <= rh.par - 2)::int  AS total_eagles_plus,
          COUNT(rh.id) FILTER (WHERE rh.score = rh.par - 1)::int   AS total_birdies,
          COUNT(rh.id) FILTER (WHERE rh.score = rh.par)::int        AS total_pars,
          COUNT(rh.id) FILTER (WHERE rh.score = rh.par + 1)::int    AS total_bogeys,
          COUNT(rh.id) FILTER (WHERE rh.score >= rh.par + 2)::int   AS total_double_plus,
          COUNT(rh.id)::int                                          AS total_holes,
          ROUND((SUM(rh.stableford_points)::numeric / NULLIF(COUNT(rh.id), 0)), 2)::float AS points_per_hole
        FROM rounds r
        JOIN round_holes rh ON rh.round_id = r.id
        WHERE r.user_id = $1 AND r.status = 'completed' ${seasonClause} ${limitClause}
        GROUP BY r.user_id
      ) hs ON hs.user_id = u.id
      WHERE u.id = $1
    `, params);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/par-stats — scoring breakdown grouped by par 3 / 4 / 5
// Optional ?limit=N (N most recent rounds) or ?season=current
router.get('/:id/par-stats', requireAuth, async (req, res) => {
  const filter = parseStatsFilter(req);
  if (!filter) return res.status(400).json({ error: 'limit must be a positive integer' });

  const params = [req.params.id];
  const seasonClause = filter.season ? "AND EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW())" : '';
  let limitClause = '';
  if (filter.limit) {
    params.push(filter.limit);
    limitClause = `AND r.id IN (
          SELECT id FROM rounds
          WHERE user_id = $1 AND status = 'completed'
            ${filter.season ? "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW())" : ''}
          ORDER BY played_at DESC, created_at DESC LIMIT $${params.length}
        )`;
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        rh.par,
        COUNT(*) FILTER (WHERE rh.score <= rh.par - 2)::int              AS eagles_plus,
        COUNT(*) FILTER (WHERE rh.score = rh.par - 1)::int               AS birdies,
        COUNT(*) FILTER (WHERE rh.score = rh.par)::int                    AS pars,
        COUNT(*) FILTER (WHERE rh.score = rh.par + 1)::int               AS bogeys,
        COUNT(*) FILTER (WHERE rh.score >= rh.par + 2)::int              AS double_plus,
        COUNT(*)::int                                                      AS total,
        ROUND(AVG(rh.score - rh.par)::numeric, 2)::float                 AS avg_vs_par
      FROM round_holes rh
      JOIN rounds r ON r.id = rh.round_id
      WHERE r.user_id = $1 AND r.status = 'completed' AND rh.par IN (3, 4, 5) ${seasonClause} ${limitClause}
      GROUP BY rh.par
      ORDER BY rh.par
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Par stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/shot-stats — putts, GIR, fairways aggregated from round_holes
// Optional ?limit=N (N most recent rounds) or ?season=current
router.get('/:id/shot-stats', requireAuth, async (req, res) => {
  const filter = parseStatsFilter(req);
  if (!filter) return res.status(400).json({ error: 'limit must be a positive integer' });

  const params = [req.params.id];
  const seasonClause = filter.season ? "AND EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW())" : '';
  let limitClause = '';
  if (filter.limit) {
    params.push(filter.limit);
    limitClause = `AND r.id IN (
          SELECT id FROM rounds
          WHERE user_id = $1 AND status = 'completed'
            ${filter.season ? "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW())" : ''}
          ORDER BY played_at DESC, created_at DESC LIMIT $${params.length}
        )`;
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        -- putts per round (only from rounds where putts were actually tracked)
        ROUND(
          SUM(rh.putts)::numeric /
          NULLIF(COUNT(DISTINCT CASE WHEN rh.putts IS NOT NULL THEN r.id END), 0),
          1
        )::float AS avg_putts_per_round,

        -- GIR %
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE rh.gir = true) /
          NULLIF(COUNT(*) FILTER (WHERE rh.gir IS NOT NULL), 0),
          1
        )::float AS gir_pct,

        -- Fairways hit %
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE rh.fairway_hit = true) /
          NULLIF(COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL), 0),
          1
        )::float AS fairways_pct,

        -- Putts per GIR hole (approach-to-pin quality)
        ROUND(
          SUM(CASE WHEN rh.gir = true AND rh.putts IS NOT NULL THEN rh.putts END)::numeric /
          NULLIF(COUNT(*) FILTER (WHERE rh.gir = true AND rh.putts IS NOT NULL), 0),
          2
        )::float AS putts_per_gir,

        -- How many holes have each stat tracked (for confidence display)
        COUNT(rh.putts)::int        AS putts_holes_tracked,
        COUNT(*) FILTER (WHERE rh.gir IS NOT NULL)::int     AS gir_holes_tracked,
        COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL)::int AS fairway_holes_tracked

      FROM round_holes rh
      JOIN rounds r ON r.id = rh.round_id
      WHERE r.user_id = $1 AND r.status = 'completed' ${seasonClause} ${limitClause}
    `, params);
    res.json(rows[0] ?? {});
  } catch (err) {
    console.error('Shot stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/hole-stats — per-hole averages for best/worst hole analysis
router.get('/:id/hole-stats', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        rh.hole_number,
        COUNT(rh.id)::int                                              AS times_played,
        ROUND(AVG(rh.score - rh.par)::numeric, 2)::float              AS avg_vs_par,
        ROUND(AVG(rh.stableford_points)::numeric, 2)::float           AS avg_points,
        MIN(rh.score - rh.par)::int                                    AS best_vs_par
      FROM round_holes rh
      JOIN rounds r ON r.id = rh.round_id
      WHERE r.user_id = $1 AND r.status = 'completed'
      GROUP BY rh.hole_number
      ORDER BY rh.hole_number
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Hole stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/rounds — that user's completed rounds, newest first
// Optional ?limit=N (N most recent rounds) or ?season=current
router.get('/:id/rounds', requireAuth, async (req, res) => {
  const filter = parseStatsFilter(req);
  if (!filter) return res.status(400).json({ error: 'limit must be a positive integer' });

  const params = [req.params.id];
  const seasonClause = filter.season ? "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW())" : '';
  let limitClause = '';
  if (filter.limit) {
    params.push(filter.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  try {
    const result = await pool.query(`
      SELECT id, played_at, course_name, score, stableford, notes, created_at,
             slope_rating, course_rating
      FROM rounds
      WHERE user_id = $1 AND status = 'completed' ${seasonClause}
      ORDER BY played_at DESC, created_at DESC
      ${limitClause}
    `, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get user rounds error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/vs-club — player's scoring/accuracy vs the average across clubs shared with the viewer
// Optional ?limit=N or ?season=current scopes the player's own numbers only — the
// club average stays all-time as a stable baseline to compare against.
router.get('/:id/vs-club', requireAuth, async (req, res) => {
  const filter = parseStatsFilter(req);
  if (!filter) return res.status(400).json({ error: 'limit must be a positive integer' });

  const params = [req.params.id, req.userId];
  const seasonClause = filter.season ? "AND EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW())" : '';
  const seasonClauseR = filter.season ? "AND EXTRACT(YEAR FROM r.played_at) = EXTRACT(YEAR FROM NOW())" : '';
  let limitClause = '';
  if (filter.limit) {
    params.push(filter.limit);
    limitClause = `AND id IN (
          SELECT id FROM rounds
          WHERE user_id = $1 AND status = 'completed' ${seasonClause}
          ORDER BY played_at DESC, created_at DESC LIMIT $${params.length}
        )`;
  }
  const limitClauseR = filter.limit ? limitClause.replace(/\bid IN\b/, 'r.id IN') : '';

  try {
    const { rows } = await pool.query(`
      WITH shared_clubs AS (
        SELECT DISTINCT m_target.club_id
        FROM club_memberships m_target
        JOIN club_memberships m_viewer ON m_viewer.club_id = m_target.club_id AND m_viewer.user_id = $2
        WHERE m_target.user_id = $1
      ),
      club_members AS (
        SELECT DISTINCT m.user_id
        FROM club_memberships m
        JOIN shared_clubs sc ON sc.club_id = m.club_id
      ),
      player_rounds AS (
        SELECT ROUND(AVG(score)::numeric, 1)::float AS avg_score
        FROM rounds
        WHERE user_id = $1 AND status = 'completed' ${seasonClause} ${limitClause}
      ),
      player_shots AS (
        SELECT
          ROUND(100.0 * COUNT(*) FILTER (WHERE rh.gir = true) / NULLIF(COUNT(*) FILTER (WHERE rh.gir IS NOT NULL), 0), 1)::float AS gir_pct,
          ROUND(100.0 * COUNT(*) FILTER (WHERE rh.fairway_hit = true) / NULLIF(COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL), 0), 1)::float AS fairways_pct
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        WHERE r.user_id = $1 AND r.status = 'completed' ${seasonClauseR} ${limitClauseR}
      ),
      club_rounds AS (
        SELECT ROUND(AVG(r.score)::numeric, 1)::float AS avg_score
        FROM rounds r
        JOIN club_members cm ON cm.user_id = r.user_id
        WHERE r.status = 'completed'
      ),
      club_shots AS (
        SELECT
          ROUND(100.0 * COUNT(*) FILTER (WHERE rh.gir = true) / NULLIF(COUNT(*) FILTER (WHERE rh.gir IS NOT NULL), 0), 1)::float AS gir_pct,
          ROUND(100.0 * COUNT(*) FILTER (WHERE rh.fairway_hit = true) / NULLIF(COUNT(*) FILTER (WHERE rh.fairway_hit IS NOT NULL), 0), 1)::float AS fairways_pct
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        JOIN club_members cm ON cm.user_id = r.user_id
        WHERE r.status = 'completed'
      )
      SELECT
        (SELECT name FROM clubs WHERE id IN (SELECT club_id FROM shared_clubs) ORDER BY id LIMIT 1) AS club_name,
        pr.avg_score      AS player_avg_score,
        ps.gir_pct        AS player_gir_pct,
        ps.fairways_pct   AS player_fairways_pct,
        cr.avg_score      AS club_avg_score,
        cs.gir_pct        AS club_gir_pct,
        cs.fairways_pct   AS club_fairways_pct
      FROM player_rounds pr, player_shots ps, club_rounds cr, club_shots cs
    `, [req.params.id, req.userId]);
    res.json(rows[0] ?? {});
  } catch (err) {
    console.error('Vs club stats error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id/handicap — owner or admin of any shared club can update handicap
router.patch('/:id/handicap', requireAuth, async (req, res) => {
  const { handicap } = req.body;
  const h = parseFloat(handicap);
  if (isNaN(h) || h < -10 || h > 54) {
    return res.status(400).json({ error: 'Handicap must be between -10 and 54' });
  }
  try {
    // Caller must be owner or admin of a club the target user also belongs to
    const { rows } = await pool.query(`
      SELECT cm_caller.role
      FROM club_memberships cm_caller
      JOIN club_memberships cm_target
        ON cm_target.club_id = cm_caller.club_id AND cm_target.user_id = $2
      WHERE cm_caller.user_id = $1 AND cm_caller.role IN ('owner', 'admin')
      LIMIT 1
    `, [req.userId, req.params.id]);

    if (!rows.length) return res.status(403).json({ error: 'Not authorised to update this handicap' });

    const { rows: [updated] } = await pool.query(
      'UPDATE users SET handicap = $1, updated_at = NOW() WHERE id = $2 RETURNING handicap',
      [h, req.params.id]
    );
    res.json({ handicap: updated.handicap });
  } catch (err) {
    console.error('Update handicap error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
