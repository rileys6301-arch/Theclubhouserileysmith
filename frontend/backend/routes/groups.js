import express from 'express';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ── List groups for a club ────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const clubId = req.query.club_id ? parseInt(req.query.club_id) : null;
  if (!clubId) return res.status(400).json({ error: 'club_id required' });
  try {
    const { rows } = await pool.query(`
      SELECT g.*,
        COUNT(cgm.competition_id)::int AS comp_count
      FROM tournament_groups g
      LEFT JOIN competition_group_members cgm ON cgm.group_id = g.id
      WHERE g.club_id = $1
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `, [clubId]);
    res.json(rows);
  } catch (err) {
    console.error('List groups error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Create group ──────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  const { clubId, name, description, scoring, scoringN } = req.body;
  if (!clubId || !name?.trim()) return res.status(400).json({ error: 'clubId and name required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO tournament_groups (club_id, name, description, scoring, scoring_n, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      parseInt(clubId),
      name.trim(),
      description?.trim() || null,
      scoring || 'total_stableford',
      parseInt(scoringN) || 3,
      req.userId,
    ]);
    res.json({ ...rows[0], comp_count: 0 });
  } catch (err) {
    console.error('Create group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Get group + competitions ──────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const [groupRes, compsRes] = await Promise.all([
      pool.query(`SELECT * FROM tournament_groups WHERE id = $1`, [groupId]),
      pool.query(`
        SELECT c.id, c.name, c.date, c.format, c.status, c.course_name,
          COUNT(DISTINCT e.player_id)::int AS entry_count
        FROM competitions c
        JOIN competition_group_members cgm ON cgm.competition_id = c.id
        LEFT JOIN competition_entries e ON e.competition_id = c.id
        WHERE cgm.group_id = $1
        GROUP BY c.id
        ORDER BY c.date ASC
      `, [groupId]),
    ]);
    if (!groupRes.rows[0]) return res.status(404).json({ error: 'Group not found' });
    res.json({ ...groupRes.rows[0], competitions: compsRes.rows });
  } catch (err) {
    console.error('Get group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Update group ──────────────────────────────────────────────────────────────

router.patch('/:id', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { name, status } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE tournament_groups
      SET name   = COALESCE($1, name),
          status = COALESCE($2, status)
      WHERE id = $3
      RETURNING *
    `, [name?.trim() || null, status || null, groupId]);
    if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Update group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Delete group ──────────────────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    await pool.query(`DELETE FROM tournament_groups WHERE id = $1`, [groupId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Add competition to group ──────────────────────────────────────────────────

router.post('/:id/competitions', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { competitionId } = req.body;
  if (!competitionId) return res.status(400).json({ error: 'competitionId required' });
  try {
    await pool.query(
      `INSERT INTO competition_group_members (group_id, competition_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [groupId, parseInt(competitionId)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Add comp to group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Remove competition from group ─────────────────────────────────────────────

router.delete('/:id/competitions/:compId', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const compId  = parseInt(req.params.compId);
  try {
    await pool.query(
      `DELETE FROM competition_group_members WHERE group_id = $1 AND competition_id = $2`,
      [groupId, compId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove comp from group error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Group leaderboard ─────────────────────────────────────────────────────────

router.get('/:id/leaderboard', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const groupRes = await pool.query(`SELECT * FROM tournament_groups WHERE id = $1`, [groupId]);
    if (!groupRes.rows[0]) return res.status(404).json({ error: 'Group not found' });
    const group = groupRes.rows[0];

    const compsRes = await pool.query(`
      SELECT c.id, c.name, c.date, c.format, c.status
      FROM competitions c
      JOIN competition_group_members cgm ON cgm.competition_id = c.id
      WHERE cgm.group_id = $1
      ORDER BY c.date ASC
    `, [groupId]);
    const competitions = compsRes.rows;

    if (!competitions.length) {
      return res.json({ group, competitions: [], entries: [] });
    }

    const compIds = competitions.map(c => c.id);

    // Per-player per-competition stableford total, using official scorer precedence
    const { rows: scoreRows } = await pool.query(`
      WITH per_hole AS (
        SELECT
          player_id,
          competition_id,
          hole_number,
          COALESCE(
            MAX(CASE WHEN submitted_by != player_id THEN stableford_points END),
            MAX(CASE WHEN submitted_by  = player_id THEN stableford_points END)
          ) AS stableford_pts
        FROM competition_scores
        WHERE competition_id = ANY($1::int[])
        GROUP BY player_id, competition_id, hole_number
      )
      SELECT
        u.id AS user_id, u.first_name, u.last_name, u.email, u.handicap,
        ph.competition_id,
        SUM(ph.stableford_pts)::int AS comp_total
      FROM per_hole ph
      JOIN users u ON u.id = ph.player_id
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.handicap, ph.competition_id
    `, [compIds]);

    // Build player map
    const playerMap = new Map();
    for (const row of scoreRows) {
      if (!playerMap.has(row.user_id)) {
        playerMap.set(row.user_id, {
          user_id:    row.user_id,
          first_name: row.first_name,
          last_name:  row.last_name,
          email:      row.email,
          handicap:   row.handicap,
          scores:     {},
        });
      }
      playerMap.get(row.user_id).scores[row.competition_id] = row.comp_total;
    }

    // Calculate totals
    const entries = Array.from(playerMap.values()).map(player => {
      const scoreArr = competitions.map(c => player.scores[c.id] ?? null);
      const played   = scoreArr.filter(s => s !== null).length;
      const nonNull  = scoreArr.filter(s => s !== null);

      let total;
      if (group.scoring === 'best_n') {
        const best = [...nonNull].sort((a, b) => b - a).slice(0, group.scoring_n);
        total = best.reduce((sum, s) => sum + s, 0);
      } else {
        total = nonNull.reduce((sum, s) => sum + s, 0);
      }

      return { ...player, scores: scoreArr, total, comps_played: played };
    });

    entries.sort((a, b) => b.total - a.total);

    res.json({ group, competitions, entries });
  } catch (err) {
    console.error('Group leaderboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
