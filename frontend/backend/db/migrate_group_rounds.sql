ALTER TABLE rounds ADD COLUMN IF NOT EXISTS group_round_id TEXT;
CREATE INDEX IF NOT EXISTS idx_rounds_group_round_id ON rounds(group_round_id) WHERE group_round_id IS NOT NULL;
