-- liquibase formatted sql
-- changeset railsim:009-mumbai-western-line
-- Mumbai: CSMT is a terminus, and Western Railway trains never ran through it.
--  * Wadi - CSMT is split at Kalyan Jn; CSMT becomes a branch off Kalyan.
--  * The Ahmedabad line starts at Vasai Road, which joins the Central line at Kalyan
--    (Diva - Vasai link, the way Pune - Ahmedabad trains run) and the suburban line
--    into Dadar (Western), a terminus.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('KYN', 'Kalyan Jn',        8, TRUE,  FALSE, 19.2437, 73.1355, FALSE),
('BSR', 'Vasai Road',       8, FALSE, FALSE, 19.3830, 72.8320, FALSE),
('DDR', 'Dadar (Western)',  7, FALSE, FALSE, 19.0190, 72.8430, TRUE);

DELETE FROM corridor_edges WHERE edge_id IN ('WADI_TO_CSMT', 'CSMT_TO_ADI');

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('WADI_TO_KYN', 'WADI', 'KYN', 551, 'DOUBLE_LINE_GHAT', 'WESTERN_GHATS_URBAN', 'WADI,KLBG,SUR,MO*,KWV,DD,PUNE,LNL,KJT*,KYN', NULL),
('KYN_TO_CSMT', 'KYN', 'CSMT', 54, 'DOUBLE_LINE', 'URBAN_SUBURBAN', 'KYN,TNA,DR,CSMT', NULL),
('KYN_TO_BSR', 'KYN', 'BSR', 52, 'DOUBLE_LINE', 'URBAN_SUBURBAN', 'KYN,BIRD*,BSR', NULL),
('DDR_TO_BSR', 'DDR', 'BSR', 43, 'DOUBLE_LINE', 'URBAN_SUBURBAN', 'DDR,BA*,BVI,BSR', NULL),
('BSR_TO_ADI', 'BSR', 'ADI', 449, 'DOUBLE_LINE_HIGH_SPEED', 'WEST_COAST_GUJARAT', 'BSR,VAPI,ST,BH*,BRC,ANND*,ADI', NULL);
