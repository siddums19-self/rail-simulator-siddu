-- liquibase formatted sql
-- changeset railsim:019-konkan-mangalore
-- Mangalore Jn hub and Konkan Railway route to Vasco da Gama, plus Hyderabad MMTS pass-through halts.
INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon, terminal) VALUES
('MAQ', 'Mangalore Jn', 6, FALSE, FALSE, 12.8639, 74.8806, FALSE);
INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('MAQ_TO_VSG', 'MAQ', 'VSG', 448, 'DOUBLE_LINE', 'KONKAN_COAST', 'MAQ,SL*,UD*,KUDA*,BTJL*,MRDW*,HNA*,KT*,GOK*,KAWR*,MAO*,VSG', NULL);
UPDATE corridor_edges SET stations_csv = 'WADI,SEM*,TDU*,VKB,LPI*,HFZ*,BMT*,SC' WHERE edge_id = 'WADI_TO_SC';
UPDATE corridor_edges SET stations_csv = 'GWD,WPR,MBNR,JCL*,SHNR,UR*,KCG,STPD*,MLY*,SC' WHERE edge_id = 'GWD_TO_SC';
UPDATE corridor_edges SET stations_csv = 'SC,JOO*,HYB' WHERE edge_id = 'SC_TO_HYB';
