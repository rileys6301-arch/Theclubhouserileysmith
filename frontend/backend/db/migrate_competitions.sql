CREATE TABLE IF NOT EXISTS competitions (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  date         DATE         NOT NULL,
  course_name  VARCHAR(200) NOT NULL,
  tee_name     VARCHAR(100),
  hole_data    JSONB,
  status       VARCHAR(20)  NOT NULL DEFAULT 'upcoming'
               CHECK (status IN ('upcoming', 'active', 'completed')),
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competition_entries (
  id               SERIAL PRIMARY KEY,
  competition_id   INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id        INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  scorer_id        INTEGER          REFERENCES users(id)        ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, player_id)
);

CREATE TABLE IF NOT EXISTS competition_scores (
  id                SERIAL PRIMARY KEY,
  competition_id    INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  player_id         INTEGER NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  hole_number       INTEGER NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  score             INTEGER NOT NULL,
  stableford_points INTEGER NOT NULL,
  submitted_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (competition_id, player_id, hole_number)
);
