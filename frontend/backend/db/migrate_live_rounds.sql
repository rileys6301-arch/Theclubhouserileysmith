-- Live round support: adds status, competition link, tee/handicap metadata, and hole template to rounds

ALTER TABLE rounds
  ADD COLUMN IF NOT EXISTS status          VARCHAR(20) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress', 'completed')),
  ADD COLUMN IF NOT EXISTS tee_name        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS slope_rating    INTEGER,
  ADD COLUMN IF NOT EXISTS course_handicap INTEGER,
  ADD COLUMN IF NOT EXISTS handicap_index  DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS competition_id  INTEGER REFERENCES competitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hole_data       JSONB;

CREATE INDEX IF NOT EXISTS rounds_live ON rounds(status) WHERE status = 'in_progress';
