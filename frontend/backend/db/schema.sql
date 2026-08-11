-- Full schema — run this once against a fresh Railway PostgreSQL database

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100),
  last_name     VARCHAR(100),
  handicap      DECIMAL(4, 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rounds
CREATE TABLE IF NOT EXISTS rounds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at   DATE NOT NULL,
  course_name VARCHAR(255) NOT NULL,
  score       INTEGER NOT NULL,
  stableford  INTEGER NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rounds_user_played ON rounds(user_id, played_at DESC);

-- Round holes (per-hole detail)
CREATE TABLE IF NOT EXISTS round_holes (
  id                UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID     NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  hole_number       SMALLINT NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par               SMALLINT NOT NULL,
  stroke_index      SMALLINT NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  score             SMALLINT NOT NULL CHECK (score > 0),
  stableford_points SMALLINT NOT NULL,
  fairway_hit       BOOLEAN,
  gir               BOOLEAN,
  putts             SMALLINT CHECK (putts >= 0),
  UNIQUE (round_id, hole_number)
);

CREATE INDEX IF NOT EXISTS round_holes_round ON round_holes(round_id);

-- Notices
CREATE TABLE IF NOT EXISTS notices (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      VARCHAR(200) NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notices_created ON notices(created_at DESC);

-- Competitions
CREATE TABLE IF NOT EXISTS competitions (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  date        DATE         NOT NULL,
  course_name VARCHAR(200) NOT NULL,
  tee_name    VARCHAR(100),
  hole_data   JSONB,
  status      VARCHAR(20)  NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming', 'active', 'completed')),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Competition entries
CREATE TABLE IF NOT EXISTS competition_entries (
  id             SERIAL  PRIMARY KEY,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id      UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scorer_id      UUID             REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, player_id)
);

-- Competition scores (per-hole, submitted by scorer)
CREATE TABLE IF NOT EXISTS competition_scores (
  id                SERIAL  PRIMARY KEY,
  competition_id    INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id         UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hole_number       INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  score             INTEGER NOT NULL,
  stableford_points INTEGER NOT NULL,
  submitted_by      UUID             REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, player_id, hole_number)
);
