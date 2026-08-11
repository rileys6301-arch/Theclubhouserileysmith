-- Add season_round_type to clubs: controls which rounds count toward the leaderboard
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS season_round_type VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (season_round_type IN ('all', 'tournament_only', 'social_only'));
