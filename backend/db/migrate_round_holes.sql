CREATE TABLE IF NOT EXISTS round_holes (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          UUID    NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  hole_number       SMALLINT NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par               SMALLINT NOT NULL,
  stroke_index      SMALLINT NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  score             SMALLINT NOT NULL CHECK (score > 0),
  stableford_points SMALLINT NOT NULL,
  UNIQUE (round_id, hole_number)
);

CREATE INDEX IF NOT EXISTS round_holes_round ON round_holes(round_id);
