-- Add shot-tracking columns to round_holes
ALTER TABLE round_holes
  ADD COLUMN IF NOT EXISTS fairway_hit BOOLEAN,
  ADD COLUMN IF NOT EXISTS gir         BOOLEAN,
  ADD COLUMN IF NOT EXISTS putts       SMALLINT CHECK (putts >= 0);
