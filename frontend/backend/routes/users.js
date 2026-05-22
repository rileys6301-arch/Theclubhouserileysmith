import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

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
        hs.points_per_hole
      FROM users u
      LEFT JOIN (
        SELECT user_id,
          COUNT(*)::int                                                              AS rounds_played,
          ROUND(AVG(stableford)::numeric, 1)::float                                 AS avg_stableford,
          MAX(stableford)::int                                                       AS best_stableford,
          MIN(score)::int                                                            AS best_score,
          ROUND(AVG(score)::numeric, 1)::float                                      AS avg_score,
          ROUND((AVG(score) - 72)::numeric, 1)::float                               AS avg_vs_par,
          COUNT(DISTINCT course_name)::int                                           AS unique_courses,
          MAX(played_at)::text                                                       AS last_played_at,
          (ARRAY_AGG(score     ORDER BY played_at DESC, created_at DESC))[1]::int   AS last_score,
          (ARRAY_AGG(stableford ORDER BY played_at DESC, created_at DESC))[1]::int  AS last_stableford,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW()))::int      AS rounds_this_year,
          COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM played_at) = EXTRACT(YEAR FROM NOW()) - 1)::int AS rounds_last_year
        FROM rounds
        WHERE user_id = $1 AND status = 'completed'
        GROUP BY user_id
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
        WHERE r.user_id = $1 AND r.status = 'completed'
        GROUP BY r.user_id
      ) hs ON hs.user_id = u.id
      WHERE u.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/:id/par-stats — scoring breakdown grouped by par 3 / 4 / 5
router.get('/:id/par-stats', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        rh.par,
        COUNT(*) FILTER (WHERE rh.score <= rh.par - 2)::int  AS eagles_plus,
        COUNT(*) FILTER (WHERE rh.score = rh.par - 1)::int   AS birdies,
        COUNT(*) FILTER (WHERE rh.score = rh.par)::int        AS pars,
        COUNT(*) FILTER (WHERE rh.score = rh.par + 1)::int    AS bogeys,
        COUNT(*) FILTER (WHERE rh.score >= rh.par + 2)::int   AS double_plus,
        COUNT(*)::int                                          AS total
      FROM round_holes rh
      JOIN rounds r ON r.id = rh.round_id
      WHERE r.user_id = $1 AND r.status = 'completed' AND rh.par IN (3, 4, 5)
      GROUP BY rh.par
      ORDER BY rh.par
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error('Par stats error:', err);
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
