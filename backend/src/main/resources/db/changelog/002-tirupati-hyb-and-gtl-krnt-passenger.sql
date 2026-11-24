-- liquibase formatted sql
-- changeset railsim:002-tirupati-hyb-and-gtl-krnt-passenger

INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon) VALUES
('TPTY', 'Tirupati',                    6, TRUE,  FALSE, 13.6288, 79.4192),
('HYB',  'Hyderabad Deccan (Nampally)', 6, TRUE,  FALSE, 17.3924, 78.4678),
('RC',   'Raichur Jn',                  3, FALSE, FALSE, 16.2076, 77.3463),
('KRNT', 'Kurnool City',                3, FALSE, FALSE, 15.8281, 78.0373),
('GWD',  'Gadwal Jn',                   3, FALSE, FALSE, 16.2336, 77.7985);

DELETE FROM corridor_edges WHERE edge_id IN ('GTL_TO_WADI', 'DHNE_TO_SC_VIA_KRNT');

UPDATE corridor_edges
SET distance_km = 69,
    stations_csv = 'GTL,MKR*,TGL*,EDD*,PDL*,LMD*,MYL*,DHNE'
WHERE edge_id = 'GTL_TO_DHNE_FLYOVER';

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('TPTY_TO_GTL', 'TPTY', 'GTL', 320, 'DOUBLE_LINE', 'EASTERN_GHATS_DECCAN',
 'TPTY,RU,KOU*,RJP,HX,YA,MOO*,TU,GY,GTL', NULL),

('GTL_TO_RC', 'GTL', 'RC', 121, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'GTL,AD,MALM,RC', NULL),

('RC_TO_WADI', 'RC', 'WADI', 108, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'RC,KSN*,SADP*,YG,WADI', NULL),

('RC_TO_GWD', 'RC', 'GWD', 57, 'SINGLE_LINE_WITH_LOOPS', 'DECCAN_PLATEAU',
 'RC,CDBH*,PASR*,PJPR*,GWD', NULL),

('DHNE_TO_KRNT', 'DHNE', 'KRNT', 54, 'SINGLE_LINE_WITH_LOOPS', 'DECCAN_PLATEAU',
 'DHNE,BVO*,VDI*,UKD*,DUU*,KRNT', NULL),

('KRNT_TO_GWD', 'KRNT', 'GWD', 56, 'SINGLE_LINE_WITH_LOOPS', 'DECCAN_PLATEAU',
 'KRNT,SBBJ*,GWD', NULL),

('GWD_TO_SC', 'GWD', 'SC', 187, 'SINGLE_LINE_WITH_LOOPS', 'DECCAN_PLATEAU',
 'GWD,WPR,MBNR,JCL*,SHNR,UR*,KCG,SC', NULL),

('SC_TO_HYB', 'SC', 'HYB', 9, 'DOUBLE_LINE', 'URBAN_SUBURBAN',
 'SC,HYB', NULL);

INSERT INTO custom_rosters
(train_number, train_name, priority_tier, coach_type, loco_class, source_code, dest_code, via_codes_csv, halts_csv, loco_swap_hub, swap_to_loco_class)
VALUES
('77414', 'Guntakal - Kurnool City Passenger (DEMU)', 'PASSENGER', 'DEMU_PASSENGER', 'DEMU-1400HP',
 'GTL', 'KRNT', 'DHNE',
 'GTL,MKR,TGL,EDD,PDL,LMD,MYL,DHNE,BVO,VDI,UKD,DUU,KRNT', NULL, NULL),

('12793', 'Tirupati - Hyderabad Rayalaseema SF (via Raichur & Wadi)', 'SUPERFAST', 'LHB', 'WAP-7',
 'TPTY', 'HYB', 'GTL,RC,WADI',
 'TPTY,RU,KOU,RJP,HX,YA,MOO,TU,GY,GTL,AD,MALM,RC,YG,WADI,SEM,TDU,VKB,LPI,SC,HYB', NULL, NULL),

('12798', 'Tirupati - Hyderabad Express (via Kurnool)', 'EXPRESS', 'LHB', 'WAP-7',
 'TPTY', 'HYB', 'GTL,KRNT',
 'TPTY,RU,RJP,HX,YA,TU,GY,GTL,DHNE,KRNT,GWD,WPR,MBNR,JCL,SHNR,UR,KCG,SC,HYB', NULL, NULL);
