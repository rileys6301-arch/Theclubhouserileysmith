-- Add 9-hole round flag to rounds table
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS is_nine_hole BOOLEAN NOT NULL DEFAULT FALSE;
