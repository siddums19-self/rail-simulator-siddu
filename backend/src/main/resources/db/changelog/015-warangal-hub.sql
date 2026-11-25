-- liquibase formatted sql
-- changeset railsim:015-warangal-hub
-- Warangal becomes a hub (selectable as source / destination): Kazipet - Nizamabad split at Warangal.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('WL', 'Warangal', 3, FALSE, FALSE, 17.9689, 79.5941, FALSE);
DELETE FROM corridor_edges WHERE edge_id = 'KZJ_TO_NZB';
INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('KZJ_TO_WL', 'KZJ', 'WL', 10,  'DOUBLE_LINE', 'DECCAN_PLATEAU', 'KZJ,WL', NULL),
('WL_TO_NZB', 'WL',  'NZB', 226, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'WL,PDPL,KRMR,ARMR*,NZB', NULL);
