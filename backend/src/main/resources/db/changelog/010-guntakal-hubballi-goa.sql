-- liquibase formatted sql
-- changeset railsim:010-guntakal-hubballi-goa
-- The Guntakal - Ballari - Hosapete - Hubballi - Londa - Vasco da Gama main line
-- (South Western Railway). It leaves Guntakal's west end, as the Adoni / Raichur line does.
-- Vasco da Gama is a terminus.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('BAY', 'Ballari Jn',       4, FALSE, FALSE, 15.1500, 76.9300, FALSE),
('HPT', 'Hosapete Jn',      4, FALSE, FALSE, 15.2694, 76.3870, FALSE),
('UBL', 'Hubballi Jn',      8, TRUE,  FALSE, 15.3500, 75.1500, FALSE),
('LD',  'Londa Jn',         3, TRUE,  FALSE, 15.4600, 74.5100, FALSE),
('VSG', 'Vasco da Gama',    4, FALSE, FALSE, 15.3980, 73.8150, TRUE);

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('GTL_TO_BAY', 'GTL', 'BAY', 48,  'DOUBLE_LINE', 'DECCAN_PLATEAU', 'GTL,BTNL*,BAY', NULL),
('BAY_TO_HPT', 'BAY', 'HPT', 63,  'DOUBLE_LINE', 'DECCAN_PLATEAU', 'BAY,KDT*,TNGL,HPT', NULL),
('HPT_TO_UBL', 'HPT', 'UBL', 141, 'DOUBLE_LINE', 'DECCAN_PLATEAU', 'HPT,MRB*,GIN*,KBL,BNP*,GDG,NGR*,UBL', NULL),
('UBL_TO_LD',  'UBL', 'LD',  79,  'DOUBLE_LINE', 'WESTERN_GHATS_PLATEAU', 'UBL,DWR,LWR,LD', NULL),
('LD_TO_VSG',  'LD',  'VSG', 118, 'DOUBLE_LINE_GHAT', 'WESTERN_GHATS_URBAN', 'LD,CLR,DDS*,QLM,SVM,MJO,VSG', NULL);
