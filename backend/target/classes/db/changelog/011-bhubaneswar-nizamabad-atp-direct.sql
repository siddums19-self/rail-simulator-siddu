-- liquibase formatted sql
-- changeset railsim:011-bhubaneswar-nizamabad-atp-direct
-- Bhubaneswar becomes a hub (Prashanti Express terminates there), so the Visakhapatnam - Howrah
-- edge is split at BBS. Nizamabad is reached from Secunderabad (Rayalaseema Express).
-- Guntakal - Anantapur direct line: leaves Guntakal's east end from PF 1/2 and bends right
-- before the road-over-bridge, avoiding Gooty.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('BBS', 'Bhubaneswar',  6, TRUE,  FALSE, 20.2665, 85.8431, FALSE),
('NZB', 'Nizamabad Jn', 4, FALSE, FALSE, 18.6725, 78.0941, FALSE);

DELETE FROM corridor_edges WHERE edge_id = 'VSKP_TO_HWH';

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('VSKP_TO_BBS', 'VSKP', 'BBS', 443, 'DOUBLE_LINE_HIGH_SPEED', 'EAST_COAST_BENGAL', 'VSKP,VZM,CHE,PSA,BAM,BALU*,KUR,BBS', NULL),
('BBS_TO_HWH',  'BBS',  'HWH', 437, 'DOUBLE_LINE_HIGH_SPEED', 'EAST_COAST_BENGAL', 'BBS,CTC,BHC,BLS,KGP,MCA*,SRC,HWH', NULL),
('ATP_TO_GTL_DIRECT', 'ATP', 'GTL', 69, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'ATP,KLU*,GTL', NULL),
('SC_TO_NZB',   'SC',   'NZB', 168, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'SC,BMO*,MED,KMC,NZB', NULL);
