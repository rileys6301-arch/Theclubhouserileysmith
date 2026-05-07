-- Allow each player to have two score entries per hole (self + marker)
ALTER TABLE competition_scores
  DROP CONSTRAINT IF EXISTS competition_scores_competition_id_player_id_hole_number_key;

ALTER TABLE competition_scores
  ADD CONSTRAINT competition_scores_competition_id_player_id_hole_number_submitted_by_key
  UNIQUE (competition_id, player_id, hole_number, submitted_by);
