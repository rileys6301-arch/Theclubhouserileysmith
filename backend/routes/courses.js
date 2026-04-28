import express from 'express';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
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

const courses = [...courseMap.values()];

// ─── Search ───────────────────────────────────────────────────────────────────

router.get('/search', requireAuth, (req, res) => {
  const q = (req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) return res.json({ courses: [] });

  const matched = courses
    .filter(c => c.name.toLowerCase().includes(q))
    .slice(0, 10)
    .map(c => ({
      id:        c.id,
      club_name: c.name,
      location:  { city: c.state, country: 'Australia' },
    }));

  res.json({ courses: matched });
});

// ─── Detail ───────────────────────────────────────────────────────────────────

router.get('/detail/:id', requireAuth, (req, res) => {
  const course = courseMap.get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json(course);
});

export default router;
