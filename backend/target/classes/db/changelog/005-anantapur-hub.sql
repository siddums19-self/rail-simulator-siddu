-- liquibase formatted sql
-- changeset railsim:005-anantapur-hub
-- Anantapur becomes a hub so journeys like Anantapur -> Kurnool (via Guntakal, with a
-- locomotive reversal at Guntakal) can be planned. The Bengaluru - Guntakal edge is split there.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon) VALUES
('ATP', 'Anantapur', 3, FALSE, FALSE, 14.6819, 77.6006);

DELETE FROM corridor_edges WHERE edge_id = 'SBC_TO_GTL';

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('SBC_TO_ATP', 'SBC', 'ATP', 213, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'SBC,YNK,GBD*,HUP,PKD*,SSPN,DMM,ATP', NULL),
('ATP_TO_GTL', 'ATP', 'GTL', 67, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'ATP,GY*,GTL', NULL);
