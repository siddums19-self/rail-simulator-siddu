-- liquibase formatted sql
-- changeset railsim:003-gtl-flyover-dhone-left
-- Corrected Guntakal east-throat geometry (v6): departing GTL toward Dhone, the
-- Dhone line is on the LEFT and curves left onto the ROR flyover; the Gooty /
-- Bengaluru double line stays on the RIGHT; the Bellary / Hospet line passes
-- under the flyover. VV Nagar Colony stays on the right of the Dhone line when
-- departing GTL (left when arriving from Dhone).

UPDATE corridor_edges
SET special_geometry_json = '{"version":6,"type":"GTL_ROR_FLYOVER","straightThroatM":1000,"flyoverPeakM":8.5,"curveDirection":"LEFT","dhoneSide":"LEFT","gootySide":"RIGHT","underpassBranch":"BELLARY","landmark":{"name":"VV NAGAR COLONY","splineDistM":1780,"lateralOffsetM":48.0,"side":"RIGHT_OF_DHONE_LINE_DEPARTING_GTL"}}'
WHERE edge_id = 'GTL_TO_DHNE_FLYOVER';
