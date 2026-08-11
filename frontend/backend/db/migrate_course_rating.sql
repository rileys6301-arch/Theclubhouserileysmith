-- Adds course_rating to rounds so the WHS Handicap Differential can be computed:
--   Differential = (Gross Score - Course Rating) × (113 / Slope Rating)
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS course_rating DECIMAL(4,1);
