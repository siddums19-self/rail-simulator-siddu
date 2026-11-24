-- liquibase formatted sql
-- changeset railsim:006-double-line-except-gtl-dhne
-- Only the Guntakal -> Dhone diversion is single line; every other corridor is double line.
UPDATE corridor_edges
SET track_type = 'DOUBLE_LINE'
WHERE edge_id <> 'GTL_TO_DHNE_FLYOVER'
  AND (track_type LIKE 'SINGLE%' OR track_type LIKE 'MIXED%');
