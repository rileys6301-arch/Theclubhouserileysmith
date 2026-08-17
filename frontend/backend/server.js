import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import authRoutes        from './routes/auth.js';
import userRoutes        from './routes/users.js';
import roundRoutes       from './routes/rounds.js';
import courseRoutes      from './routes/courses.js';
import socialRoutes      from './routes/social.js';
import noticeRoutes      from './routes/notices.js';
import competitionRoutes from './routes/competitions.js';
import groupRoutes        from './routes/groups.js';
import adminRoutes       from './routes/admin.js';
import clubRoutes        from './routes/clubs.js';
import setupTournament   from './routes/setup_tournament.js';
import pool              from './db/index.js';
import { setIo }         from './socket.js';

dotenv.config();

// Last-resort safety net: log and keep serving instead of taking every connected
// user down over one unexpected error in a fire-and-forget path (push notifications,
// leaderboard broadcast, etc.) that isn't already wrapped in its own try/catch.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server continuing):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server continuing):', reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app        = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 3001;
const PROD = process.env.NODE_ENV === 'production';

const ALLOWED_ORIGINS = [
  'capacitor://localhost',
  'http://localhost',
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://golf-app-production-205b.up.railway.app';

app.use(cors({
  origin: PROD ? ['capacitor://localhost', 'http://localhost', RAILWAY_URL] : 'http://localhost:5174',
  credentials: true,
}));
app.use(express.json({ limit: '20mb' }));

// ── API routes ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth',         authRoutes);
app.use('/api/users',        userRoutes);
app.use('/api/rounds',       roundRoutes);
app.use('/api/courses',      courseRoutes);
app.use('/api/social',       socialRoutes);
app.use('/api/notices',      noticeRoutes);
app.use('/api/competitions', competitionRoutes);
app.use('/api/groups',       groupRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/clubs',        clubRoutes);
app.use('/api/setup',        setupTournament);

app.use('/api/*', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new SocketIO(httpServer, {
  cors: {
    origin: PROD
      ? ['capacitor://localhost', 'http://localhost', RAILWAY_URL]
      : '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});
setIo(io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  socket.on('join_round', async ({ roundId }) => {
    if (!roundId) return;
    socket.join(`round:${roundId}`);
    try {
      const { rows } = await pool.query(`
        SELECT
          rh.hole_number,
          rh.score,
          rh.stableford_points,
          r.user_id,
          r.score      AS total_score,
          r.stableford AS total_stableford
        FROM round_holes rh
        JOIN rounds r ON r.id = rh.round_id
        WHERE rh.round_id = $1
        ORDER BY rh.hole_number
      `, [roundId]);
      if (rows.length) {
        socket.emit('round_state', rows.map(row => ({
          roundId:        parseInt(roundId),
          userId:         row.user_id,
          holeNumber:     row.hole_number,
          score:          row.score,
          stablefordPoints: row.stableford_points,
          totalScore:     row.total_score,
          totalStableford: row.total_stableford,
        })));
      }
    } catch (err) {
      console.error('round_state query error:', err.message);
    }
  });

  socket.on('leave_round', ({ roundId }) => {
    if (roundId) socket.leave(`round:${roundId}`);
  });

  socket.on('join_competition', ({ competitionId }) => {
    if (competitionId) socket.join(`competition:${competitionId}`);
  });

  socket.on('leave_competition', ({ competitionId }) => {
    if (competitionId) socket.leave(`competition:${competitionId}`);
  });
});

// ── Serve React frontend in production ──────────────────────────────────────
if (PROD) {
  const distDir = path.join(__dirname, '../dist');
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

httpServer.listen(PORT, () => {
  console.log(`The Circuit server running on port ${PORT}`);
});

// ── Cleanup stale live rounds ────────────────────────────────────────────────
async function cleanupStaleRounds() {
  try {
    const { rowCount } = await pool.query(`
      DELETE FROM rounds
      WHERE status = 'in_progress'
        AND created_at < NOW() - INTERVAL '12 hours'
    `);
    if (rowCount > 0) console.log(`Cleaned up ${rowCount} stale live round(s)`);
  } catch (err) {
    console.error('Stale round cleanup error:', err.message);
  }
}

// ── Schema migrations (idempotent, run in order) ─────────────────────────────
async function migrate(label, sql) {
  try {
    await pool.query(sql);
  } catch (err) {
    console.error(`Migration failed [${label}]:`, err.message);
  }
}

async function runMigrations() {
  try {
    // Legacy: keep club columns on users for backwards compat
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS club_name VARCHAR(60),
        ADD COLUMN IF NOT EXISTS club_code VARCHAR(12),
        ADD COLUMN IF NOT EXISTS club_role VARCHAR(10)
    `);

    // Proper clubs entity
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clubs (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(60) NOT NULL,
        code       VARCHAR(12) UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Many-to-many: users ↔ clubs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS club_memberships (
        id        SERIAL PRIMARY KEY,
        user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        club_id   INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        role      VARCHAR(10) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, club_id)
      )
    `);

    // status on rounds (older DBs may not have it)
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'completed'`);

    // club_id on dependent tables
    await pool.query(`ALTER TABLE rounds       ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE competitions ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE SET NULL`);
    await pool.query(`ALTER TABLE notices      ADD COLUMN IF NOT EXISTS club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE`);

    // Leaderboard config on clubs
    await pool.query(`
      ALTER TABLE clubs
        ADD COLUMN IF NOT EXISTS leaderboard_format VARCHAR(20) NOT NULL DEFAULT 'total_points',
        ADD COLUMN IF NOT EXISTS leaderboard_n      INTEGER     NOT NULL DEFAULT 8
    `);

    // Seasons
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seasons (
        id         SERIAL PRIMARY KEY,
        club_id    INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        name       VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date   DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Club rules
    await pool.query(`
      CREATE TABLE IF NOT EXISTS club_rules (
        id         SERIAL PRIMARY KEY,
        club_id    INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        title      VARCHAR(200),
        body       TEXT NOT NULL,
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Competition format and team size
    await pool.query(`ALTER TABLE competitions ADD COLUMN IF NOT EXISTS format VARCHAR(20) NOT NULL DEFAULT 'stableford'`);
    await pool.query(`ALTER TABLE competitions ADD COLUMN IF NOT EXISTS team_size INTEGER NOT NULL DEFAULT 1`);

    // Group stats visibility toggle
    await pool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS show_group_stats BOOLEAN NOT NULL DEFAULT false`);

    // Season round type: controls which round types count toward leaderboard
    await pool.query(`
      ALTER TABLE clubs
        ADD COLUMN IF NOT EXISTS season_round_type VARCHAR(20) NOT NULL DEFAULT 'all'
    `);

    // Per-type leaderboard inclusion flags (replaces single season_round_type)
    await pool.query(`
      ALTER TABLE clubs
        ADD COLUMN IF NOT EXISTS include_tournaments BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS include_scoring     BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS include_social      BOOLEAN NOT NULL DEFAULT true
    `);

    // Round type: scoring vs social for non-tournament rounds
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS round_type VARCHAR(20) NOT NULL DEFAULT 'social'`);

    // Scoring partner (the playing partner who validates a scoring round)
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS scoring_partner_id UUID REFERENCES users(id) ON DELETE SET NULL`);

    // Custom courses added by users when theirs isn't in the CSV
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_courses (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        city          VARCHAR(100),
        country       VARCHAR(100) NOT NULL DEFAULT 'Australia',
        slope_rating  DECIMAL(5,1),
        course_rating DECIMAL(5,1),
        par_total     INT,
        hole_data     JSONB NOT NULL DEFAULT '[]',
        created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Indexes for competition live scoring performance
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comp_scores_comp      ON competition_scores(competition_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comp_scores_comp_plyr ON competition_scores(competition_id, player_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_comp_entries_comp     ON competition_entries(competition_id)`);

    // Shot-tracking columns on round_holes and competition_scores
    await pool.query(`
      ALTER TABLE round_holes
        ADD COLUMN IF NOT EXISTS fairway_hit BOOLEAN,
        ADD COLUMN IF NOT EXISTS gir         BOOLEAN,
        ADD COLUMN IF NOT EXISTS putts       SMALLINT
    `);
    await pool.query(`
      ALTER TABLE competition_scores
        ADD COLUMN IF NOT EXISTS fairway_hit BOOLEAN,
        ADD COLUMN IF NOT EXISTS gir         BOOLEAN,
        ADD COLUMN IF NOT EXISTS putts       SMALLINT
    `);

    // Migrate existing users.club_* rows → clubs + club_memberships
    await pool.query(`
      INSERT INTO clubs (name, code)
      SELECT DISTINCT ON (club_code) club_name, club_code
      FROM users
      WHERE club_name IS NOT NULL AND club_code IS NOT NULL
      ON CONFLICT (code) DO NOTHING
    `);
    await pool.query(`
      INSERT INTO club_memberships (user_id, club_id, role)
      SELECT u.id, c.id, COALESCE(u.club_role, 'member')
      FROM users u
      JOIN clubs c ON c.code = u.club_code
      WHERE u.club_name IS NOT NULL AND u.club_code IS NOT NULL
      ON CONFLICT (user_id, club_id) DO NOTHING
    `);

    // Notice board enhancements: photos, comments, reactions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice_photos (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notice_id  UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        photo_data TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice_comments (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notice_id  UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notice_reactions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        notice_id  UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji      VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(notice_id, user_id, emoji)
      )
    `);

    // Social feed: photo on rounds, comments, reactions
    await pool.query(`ALTER TABLE rounds ADD COLUMN IF NOT EXISTS photo_data TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS round_comments (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id   UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS round_reactions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        round_id   UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji      VARCHAR(10) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(round_id, user_id, emoji)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournament_groups (
        id          SERIAL PRIMARY KEY,
        club_id     INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
        name        VARCHAR(200) NOT NULL,
        description TEXT,
        scoring     VARCHAR(20) NOT NULL DEFAULT 'total_stableford',
        scoring_n   INTEGER NOT NULL DEFAULT 3,
        status      VARCHAR(20) NOT NULL DEFAULT 'active',
        created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS competition_group_members (
        group_id       INTEGER NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
        competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
        added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, competition_id)
      )
    `);

  } catch (err) {
    console.error('Migration error:', err.message);
  }

  // ── Isolated migrations — each runs independently so one failure can't block others ──
  // 9-hole round flag — rounds marked as 9-hole don't count toward handicap
  await migrate('is_nine_hole', `ALTER TABLE rounds ADD COLUMN IF NOT EXISTS is_nine_hole BOOLEAN NOT NULL DEFAULT FALSE`);

  // Allow 'abandoned' as a third round status so exiting mid-round doesn't delete scores.
  // DROP + re-ADD because PostgreSQL has no ALTER CONSTRAINT for CHECK expressions.
  await migrate('round_abandoned_status', `
    ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
    ALTER TABLE rounds ADD CONSTRAINT rounds_status_check
      CHECK (status IN ('in_progress', 'completed', 'abandoned'))
  `);

  await migrate('course_hole_corrections', `
    CREATE TABLE IF NOT EXISTS course_hole_corrections (
      id         SERIAL PRIMARY KEY,
      course_id  VARCHAR(255) NOT NULL,
      tee_name   VARCHAR(100) NOT NULL,
      holes      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(course_id, tee_name)
    )
  `);

  // Join code for standalone (no-club) tournaments
  await migrate('competition_join_code', `ALTER TABLE competitions ADD COLUMN IF NOT EXISTS join_code VARCHAR(8) UNIQUE`);

  // Group round id linking rounds played together in a live group round
  await migrate('group_rounds', `
    ALTER TABLE rounds ADD COLUMN IF NOT EXISTS group_round_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_rounds_group_round_id ON rounds(group_round_id) WHERE group_round_id IS NOT NULL
  `);

  // Guest players: a tournament creator can add someone with no account. They get a
  // real (unusable, is_guest) users row so every existing scores/leaderboard/entries
  // query keeps working unchanged instead of needing a nullable-player_id branch everywhere.
  await migrate('guest_users', `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE`);

  // Per-tournament handicap override — set by the creator when adding a player,
  // independent of that player's profile handicap used everywhere else in the app.
  await migrate('competition_entry_handicap', `ALTER TABLE competition_entries ADD COLUMN IF NOT EXISTS handicap NUMERIC(4,1)`);

  // Best-ball team grouping — an arbitrary shared integer per team, scoped to the
  // competition. Team membership (not the pairwise scorer_id marker relationship)
  // is what the leaderboard groups on for best_ball, since a team can be 2-4 players.
  await migrate('competition_entry_team', `ALTER TABLE competition_entries ADD COLUMN IF NOT EXISTS team_id INTEGER`);
}

runMigrations().then(() => {
  cleanupStaleRounds();
  setInterval(cleanupStaleRounds, 60 * 60 * 1000);
});
