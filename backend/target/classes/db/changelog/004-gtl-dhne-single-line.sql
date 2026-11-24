-- liquibase formatted sql
-- changeset railsim:004-gtl-dhne-single-line
-- Guntakal - Dhone is a single line with crossing loops (not double line).
UPDATE corridor_edges
SET track_type = 'SINGLE_LINE_WITH_LOOPS'
WHERE edge_id = 'GTL_TO_DHNE_FLYOVER';
