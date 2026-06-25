import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import pool from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// ─── Load and parse CSV once at startup ──────────────────────────────────────

const CSV_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/golf_courses.csv');

function parseCsv(raw) {
  const lines = raw.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

function slugify(name, state) {
  return `${name}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildHoles(row) {
  const holes = [];
  for (let n = 1; n <= 18; n++) {
    const par = parseInt(row[`Hole ${n} Par`]);
    const si  = parseInt(row[`Hole ${n} SI`]);
    if (!isNaN(par) && !isNaN(si)) {
      holes.push({ number: n, par, si });
    }
  }
  return holes;
}

const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf-8'));

// Unique courses (name + state), keyed by slug
const courseMap = new Map();
for (const row of rows) {
  const slug = slugify(row['Course Name'], row['State']);
  if (!courseMap.has(slug)) {
    courseMap.set(slug, { id: slug, name: row['Course Name'], state: row['State'], tees: [] });
  }
  courseMap.get(slug).tees.push({
    name:         `${row['Tee Colour']} (${row['Gender']})`,
    colour:       row['Tee Colour'],
    gender:       row['Gender'],
    slopeRating:  parseFloat(row['Slope Rating']) || null,
    courseRating: parseFloat(row['Course Rating']) || null,
    parTotal:     parseInt(row['Par Total']) || null,
    holes:        buildHoles(row),
  });
}

const csvCourses = [...courseMap.values()];

// ─── Search (CSV + custom DB) ─────────────────────────────────────────────────

router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) return res.json({ courses: [] });

  const csvMatches = csvCourses
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 8)
    .map(c => ({
      id:        c.id,
      club_name: c.name,
      location:  { city: c.state, country: 'Australia' },
    }));

  let customMatches = [];
  try {
    const result = await pool.query(
      `SELECT id, name, city, country FROM custom_courses WHERE LOWER(name) LIKE $1 LIMIT 5`,
      [`%${q}%`]
    );
    customMatches = result.rows.map(r => ({
      id:        `custom-${r.id}`,
      club_name: r.name,
      location:  { city: r.city || '', country: r.country || 'Australia' },
    }));
  } catch { /* ignore — DB may not have table yet */ }

  res.json({ courses: [...csvMatches, ...customMatches].slice(0, 10) });
});

// ─── Detail (CSV or custom) ───────────────────────────────────────────────────

router.get('/detail/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  if (id.startsWith('custom-')) {
    const numId = parseInt(id.replace('custom-', ''));
    if (isNaN(numId)) return res.status(404).json({ error: 'Course not found' });
    try {
      const result = await pool.query(
        `SELECT id, name, city, country, slope_rating, course_rating, par_total, hole_data
           FROM custom_courses WHERE id = $1`,
        [numId]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Course not found' });
      const r = result.rows[0];
      return res.json({
        id,
        name:  r.name,
        state: r.city,
        tees: [{
          name:         'Standard',
          colour:       'Standard',
          slopeRating:  parseFloat(r.slope_rating) || null,
          courseRating: parseFloat(r.course_rating) || null,
          parTotal:     r.par_total || null,
          holes:        r.hole_data,
        }],
      });
    } catch (err) {
      console.error('Custom course detail error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  const course = courseMap.get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  // Merge any scanned corrections from the DB over the CSV baseline
  try {
    const { rows } = await pool.query(
      `SELECT tee_name, holes FROM course_hole_corrections WHERE course_id = $1`,
      [id]
    );
    if (rows.length) {
      const corrMap = Object.fromEntries(rows.map(r => [r.tee_name, r.holes]));
      const tees = course.tees.map(tee => {
        const fixes = corrMap[tee.name];
        if (!fixes) return tee;
        const holes = tee.holes.map(h => {
          const fix = fixes.find(f => f.number === h.number);
          return fix ? { ...h, par: fix.par ?? h.par, si: fix.si ?? h.si } : h;
        });
        const parTotal = holes.reduce((s, h) => s + h.par, 0);
        return { ...tee, holes, parTotal };
      });
      return res.json({ ...course, tees });
    }
  } catch { /* table may not exist yet on old deploys */ }

  res.json(course);
});

// ─── Save scanned hole corrections for a CSV course ───────────────────────────

router.post('/:id/corrections', requireAuth, async (req, res) => {
  const { teeName, holes } = req.body;
  if (!teeName || !Array.isArray(holes) || !holes.length) {
    return res.status(400).json({ error: 'teeName and holes required' });
  }
  try {
    await pool.query(`
      INSERT INTO course_hole_corrections (course_id, tee_name, holes)
      VALUES ($1, $2, $3)
      ON CONFLICT (course_id, tee_name)
      DO UPDATE SET holes = $3, updated_at = NOW()
    `, [req.params.id, teeName, JSON.stringify(holes)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Corrections save error:', err);
    res.status(500).json({ error: 'Could not save corrections' });
  }
});

// ─── Save a manually entered course ──────────────────────────────────────────

router.post('/custom', requireAuth, async (req, res) => {
  const { name, city, country, slopeRating, courseRating, parTotal, holes } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Course name is required' });
  if (!Array.isArray(holes) || holes.length !== 18) {
    return res.status(400).json({ error: '18 holes required' });
  }

  const siValues = holes.map(h => h.si);
  const siSet    = new Set(siValues);
  if (siValues.some(si => si < 1 || si > 18) || siSet.size !== 18) {
    return res.status(400).json({ error: 'Stroke indexes must be unique values 1–18' });
  }

  try {
    const pt = parTotal || holes.reduce((s, h) => s + (h.par || 0), 0);
    const result = await pool.query(`
      INSERT INTO custom_courses (name, city, country, slope_rating, course_rating, par_total, hole_data, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      name.trim(),
      city?.trim() || null,
      country?.trim() || 'Australia',
      slopeRating  ? parseFloat(slopeRating)  : null,
      courseRating ? parseFloat(courseRating) : null,
      pt,
      JSON.stringify(holes),
      req.userId,
    ]);

    const id = `custom-${result.rows[0].id}`;
    res.json({
      id,
      club_name: name.trim(),
      location:  { city: city?.trim() || '', country: country?.trim() || 'Australia' },
      tees: [{
        name:         'Standard',
        colour:       'Standard',
        slopeRating:  slopeRating  ? parseFloat(slopeRating)  : null,
        courseRating: courseRating ? parseFloat(courseRating) : null,
        parTotal:     pt,
        holes,
      }],
    });
  } catch (err) {
    console.error('Custom course save error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
