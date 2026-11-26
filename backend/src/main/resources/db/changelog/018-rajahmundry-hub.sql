-- liquibase formatted sql
-- changeset railsim:018-rajahmundry-hub
-- Rajahmundry becomes a selectable hub; BZA_TO_VSKP splits at RJY.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('RJY', 'Rajahmundry', 5, FALSE, FALSE, 16.9891, 81.7870, FALSE);
DELETE FROM corridor_edges WHERE edge_id = 'BZA_TO_VSKP';
INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('BZA_TO_RJY', 'BZA', 'RJY', 149, 'DOUBLE_LINE_HIGH_SPEED', 'GODAVARI_COAST', 'BZA,EE,TDD*,NDD*,RJY', NULL),
('RJY_TO_VSKP', 'RJY', 'VSKP', 201, 'DOUBLE_LINE_HIGH_SPEED', 'GODAVARI_COAST', 'RJY,SLO,ANV*,TUNI*,AKP*,DVD*,VSKP', NULL);
