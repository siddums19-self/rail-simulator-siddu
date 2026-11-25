-- liquibase formatted sql
-- changeset railsim:017-nagpur-howrah-delhi-links
-- Nagpur becomes a hub (Kazipet - New Delhi split there); Mumbai - Nagpur - Howrah (Duranto route),
-- New Delhi - Howrah (via Kanpur, Prayagraj, DDU, Gaya, Dhanbad, Asansol) and Vijayawada - Warangal
-- (so Chennai - New Delhi runs via Vijayawada and Kazipet).
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('NGP', 'Nagpur Jn', 8, TRUE, FALSE, 21.1527, 79.0888, FALSE);
DELETE FROM corridor_edges WHERE edge_id = 'KZJ_TO_NDLS';
INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('KZJ_TO_NGP',  'KZJ',  'NGP',  448,  'DOUBLE_LINE_HIGH_SPEED', 'CENTRAL_NORTH_PLAINS', 'KZJ,RDM,MCI*,BPQ,SEGM*,NGP', NULL),
('NGP_TO_NDLS', 'NGP',  'NDLS', 1087, 'DOUBLE_LINE_HIGH_SPEED', 'CENTRAL_NORTH_PLAINS', 'NGP,BZU*,ET,BPL,BINA,LAR*,VGLJ,GWL,AGC,MTJ,FDB*,NZM,NDLS', NULL),
('KYN_TO_NGP',  'KYN',  'NGP',  785,  'DOUBLE_LINE_GHAT', 'CENTRAL_NORTH_PLAINS', 'KYN,KSRA*,IGP,NK,MMR,JL,BSL,AK,BD,WR,NGP', NULL),
('NGP_TO_HWH',  'NGP',  'HWH',  1130, 'DOUBLE_LINE_HIGH_SPEED', 'EAST_COAST_BENGAL', 'NGP,G,DURG,R,BSP,JSG,ROU,CKP,TATA,KGP,HWH', NULL),
('NDLS_TO_HWH', 'NDLS', 'HWH',  1450, 'DOUBLE_LINE_HIGH_SPEED', 'CENTRAL_NORTH_PLAINS', 'NDLS,GZB*,ALJN*,ETW*,CNB,PRYJ,MZP*,DDU,BXR*,SSM*,GAYA,KQR*,DHN,ASN,DGR*,BWN,HWH', NULL),
('BZA_TO_WL',   'BZA',  'WL',   208,  'DOUBLE_LINE_HIGH_SPEED', 'DECCAN_PLATEAU', 'BZA,KDGH*,MDR*,KMT,DKJ,MABD,WL', NULL);
