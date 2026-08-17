import express from 'express';
import pool from '../db/index.js';

const router = express.Router();

const PLAYERS = [
  { first: 'Tim',     last: 'Gilberd',       handicap: 6  },
  { first: 'Brad',    last: 'Hansell',        handicap: 7  },
  { first: 'Shane',   last: 'Field',          handicap: 8  },
  { first: 'Sam',     last: 'Isemonger',      handicap: 9  },
  { first: 'Trent',   last: 'Youlten',        handicap: 13 },
  { first: 'Jens',    last: 'Lindhart',       handicap: 14 },
  { first: 'Shane',   last: 'Hedley',         handicap: 15 },
  { first: 'Rowen',   last: 'Hansell',        handicap: 16 },
  { first: 'Grant',   last: 'Stewart',        handicap: 17 },
  { first: 'Russ',    last: 'Wallace',        handicap: 18 },
  { first: 'Shane',   last: 'Hulbert',        handicap: 21 },
  { first: 'Jeremy',  last: 'Gotch',          handicap: 22 },
  { first: 'Riley',   last: 'Smith',          handicap: 22 },
  { first: 'Mark',    last: 'Featherstone',   handicap: 23 },
  { first: 'Josh',    last: 'Benton',         handicap: 23 },
  { first: 'Fabio',   last: 'Macey',          handicap: 24 },
  { first: 'Lucas',   last: 'Gear',           handicap: 24 },
  { first: 'Steve',   last: 'Barry',          handicap: 25 },
  { first: 'Craig',   last: 'Ashworth',       handicap: 27 },
  { first: 'Matt',    last: 'Rivers',         handicap: 28 },
  { first: 'Mark',    last: "O'Keeffe",       handicap: 29 },
  { first: 'Darren',  last: 'Smith',          handicap: 29 },
  { first: 'Ben',     last: 'Isemonger',      handicap: 30 },
  { first: 'Ben',     last: 'Beckett',        handicap: 30 },
  { first: 'Daniel',  last: 'Beckett',        handicap: 31 },
  { first: 'Hayden',  last: 'Garn',           handicap: 36 },
  { first: 'Rian',    last: 'Winn',           handicap: 38 },
  { first: 'Ben',     last: 'Dalton',         handicap: 45 },
];

router.post('/setup-sandbaggers-tournament', async (req, res) => {
  const pw = req.headers['x-admin-password'];
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find the Sand Baggers club
    const clubRes = await pool.query(
      `SELECT id, name FROM clubs WHERE LOWER(name) LIKE '%sand%' OR LOWER(name) LIKE '%baggers%' LIMIT 1`
    );
    if (!clubRes.rows.length) return res.status(404).json({ error: 'Sand Baggers club not found' });
    const club = clubRes.rows[0];

    // Find creator (Riley Smith)
    const creatorRes = await pool.query(
      `SELECT id FROM users WHERE LOWER(first_name) = 'riley' AND LOWER(last_name) = 'smith' LIMIT 1`
    );
    if (!creatorRes.rows.length) return res.status(404).json({ error: 'Riley Smith not found in users' });
    const creatorId = creatorRes.rows[0].id;

    // Create the competition
    const compRes = await pool.query(`
      INSERT INTO competitions
        (name, description, date, course_name, tee_name, format, team_size, status, club_id, created_by, created_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING id
    `, [
      'Day One - Lost Farm Best Ball',
      '2 Ball Best Ball - Barnbougle Lost Farm',
      '2026-09-16',
      'Barnbougle Lost Farm',
      'Black',
      'stableford',
      2,
      'upcoming',
      club.id,
      creatorId,
    ]);
    const compId = compRes.rows[0].id;

    // Match players and enter them
    const found = [];
    const notFound = [];

    for (const p of PLAYERS) {
      const userRes = await pool.query(
        `SELECT id, first_name, last_name, handicap_index FROM users
         WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) LIMIT 1`,
        [p.first, p.last]
      );
      if (userRes.rows.length) {
        const user = userRes.rows[0];
        await pool.query(
          `INSERT INTO competition_entries (competition_id, player_id, handicap, created_at)
           VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
          [compId, user.id, p.handicap]
        );
        found.push(`${p.first} ${p.last} (hcp ${p.handicap})`);
      } else {
        notFound.push(`${p.first} ${p.last} (hcp ${p.handicap})`);
      }
    }

    res.json({
      ok: true,
      competition_id: compId,
      club: club.name,
      players_entered: found,
      players_not_found: notFound,
    });
  } catch (err) {
    console.error('Setup tournament error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
