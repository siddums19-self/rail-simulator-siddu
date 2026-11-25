-- liquibase formatted sql
-- changeset railsim:012-kazipet-hub-extra-halts
-- Kazipet becomes a hub (SC - NDLS split there) with the Kazipet - Warangal - Peddapalli - Karimnagar -
-- Nizamabad line (Rayalaseema Express). Extra wayside halts for the Prashanti / Amaravati Express.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('KZJ', 'Kazipet Jn', 4, TRUE, FALSE, 17.9784, 79.5300, FALSE);
DELETE FROM corridor_edges WHERE edge_id = 'SC_TO_NDLS';
INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('SC_TO_KZJ',   'SC',  'KZJ',  132,  'DOUBLE_LINE_HIGH_SPEED', 'DECCAN_PLATEAU', 'SC,BG*,JN*,KZJ', NULL),
('KZJ_TO_NDLS', 'KZJ', 'NDLS', 1535, 'DOUBLE_LINE_HIGH_SPEED', 'CENTRAL_NORTH_PLAINS', 'KZJ,RDM,MCI*,BPQ,SEGM*,NGP,BZU*,ET,BPL,BINA,LAR*,VGLJ,GWL,AGC,MTJ,FDB*,NZM,NDLS', NULL),
('KZJ_TO_NZB',  'KZJ', 'NZB',  236,  'DOUBLE_LINE', 'DECCAN_PLATEAU', 'KZJ,WL,PDPL,KRMR,ARMR*,NZB', NULL);
UPDATE corridor_edges SET stations_csv = 'DHNE,BMH*,NDL,GID*,CBM,MRK*,DKD*,VKN*,NRT,GNT,KCC*,BZA' WHERE edge_id = 'DHNE_TO_BZA';
UPDATE corridor_edges SET stations_csv = 'BZA,EE,TDD*,NDD*,RJY,SLO,ANV*,TUNI*,AKP*,DVD*,VSKP' WHERE edge_id = 'BZA_TO_VSKP';
UPDATE corridor_edges SET stations_csv = 'VSKP,VZM,CHE,PSA,SPT*,IPM*,BAM,CAP*,BALU*,KUR,BBS' WHERE edge_id = 'VSKP_TO_BBS';
