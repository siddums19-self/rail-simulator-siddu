-- liquibase formatted sql
-- changeset railsim:001-schema-and-seed

CREATE TABLE rail_hubs (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    platforms INT NOT NULL,
    loco_change_allowed BOOLEAN DEFAULT TRUE,
    mandatory_reversal BOOLEAN DEFAULT FALSE,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL
);

CREATE TABLE corridor_edges (
    edge_id VARCHAR(64) PRIMARY KEY,
    from_hub VARCHAR(10) NOT NULL REFERENCES rail_hubs(code),
    to_hub VARCHAR(10) NOT NULL REFERENCES rail_hubs(code),
    distance_km DOUBLE PRECISION NOT NULL,
    track_type VARCHAR(40) NOT NULL,
    biome VARCHAR(50) NOT NULL,
    stations_csv TEXT NOT NULL,
    special_geometry_json TEXT
);

CREATE TABLE custom_rosters (
    id BIGSERIAL PRIMARY KEY,
    train_number VARCHAR(20) NOT NULL,
    train_name VARCHAR(120) NOT NULL,
    priority_tier VARCHAR(30) NOT NULL,
    coach_type VARCHAR(30) NOT NULL,
    loco_class VARCHAR(20) NOT NULL,
    source_code VARCHAR(10) NOT NULL,
    dest_code VARCHAR(10) NOT NULL,
    via_codes_csv VARCHAR(120),
    halts_csv TEXT NOT NULL,
    loco_swap_hub VARCHAR(10),
    swap_to_loco_class VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO rail_hubs (code, name, platforms, loco_change_allowed, mandatory_reversal, lat, lon) VALUES
('GTL',  'Guntakal Jn',         7,  TRUE,  FALSE, 15.1674, 77.3769),
('SC',   'Secunderabad Jn',     10, TRUE,  FALSE, 17.4344, 78.5013),
('SBC',  'KSR Bengaluru',       10, TRUE,  FALSE, 12.9781, 77.5697),
('NDLS', 'New Delhi',           16, TRUE,  FALSE, 28.6429, 77.2191),
('CSMT', 'Mumbai CSMT',         18, TRUE,  FALSE, 18.9398, 72.8355),
('MAS',  'MGR Chennai Central', 17, TRUE,  FALSE, 13.0827, 80.2757),
('BZA',  'Vijayawada Jn',       10, TRUE,  FALSE, 16.5186, 80.6199),
('VSKP', 'Visakhapatnam',       8,  TRUE,  TRUE,  17.7215, 83.2896),
('HWH',  'Howrah Jn',           23, TRUE,  FALSE, 22.5839, 88.3426),
('CBE',  'Coimbatore Jn',       6,  TRUE,  FALSE, 10.9968, 76.9669),
('ADI',  'Ahmedabad Jn',        12, TRUE,  FALSE, 23.0268, 72.6012),
('JP',   'Jaipur Jn',           7,  TRUE,  FALSE, 26.9196, 75.7878),
('WADI', 'Wadi Jn',             4,  FALSE, FALSE, 17.0472, 76.9922),
('DHNE', 'Dhone Jn',            4,  FALSE, FALSE, 15.3948, 77.8712);

INSERT INTO corridor_edges (edge_id, from_hub, to_hub, distance_km, track_type, biome, stations_csv, special_geometry_json) VALUES
('CBE_TO_SBC', 'CBE', 'SBC', 418, 'MIXED_SINGLE_DOUBLE', 'WESTERN_GHATS_PLATEAU',
 'CBE,TUP,ED,SA,DPJ*,HSRA*,SBC', NULL),

('SBC_TO_GTL', 'SBC', 'GTL', 280, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'SBC,YNK,GBD*,HUP,PKD*,SSPN,DMM,ATP,GY*,GTL', NULL),

('GTL_TO_DHNE_FLYOVER', 'GTL', 'DHNE', 54, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'GTL,PDL*,DHNE',
 '{"type":"GTL_ROR_FLYOVER","straightThroatM":1000,"flyoverPeakM":8.5,"curveDirection":"RIGHT","lowerBranch":"GOOTY","landmark":{"name":"VV NAGAR COLONY","splineDistM":1650,"lateralOffsetM":45.0}}'),

('DHNE_TO_SC_VIA_KRNT', 'DHNE', 'SC', 297, 'SINGLE_LINE_WITH_LOOPS', 'DECCAN_PLATEAU',
 'DHNE,VDI*,KRNT,GWD,WPR*,MBNR,JCL*,SHNR*,KCG,SC', NULL),

('GTL_TO_WADI', 'GTL', 'WADI', 229, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'GTL,AD,MALM*,RC,KSN*,YG,WADI', NULL),

('WADI_TO_SC', 'WADI', 'SC', 184, 'DOUBLE_LINE', 'DECCAN_PLATEAU',
 'WADI,SEM*,TDU*,VKB,LPI*,SC', NULL),

('SC_TO_NDLS', 'SC', 'NDLS', 1667, 'DOUBLE_LINE_HIGH_SPEED', 'CENTRAL_NORTH_PLAINS',
 'SC,BG*,KZJ,RDM,MCI*,BPQ,SEGM*,NGP,BZU*,ET,BPL,BINA,LAR*,VGLJ,GWL,AGC,MTJ,FDB*,NZM,NDLS', NULL),

('WADI_TO_CSMT', 'WADI', 'CSMT', 605, 'DOUBLE_LINE_GHAT', 'WESTERN_GHATS_URBAN',
 'WADI,KLBG,SUR,MO*,KWV,DD,PUNE,LNL,KJT*,KYN,TNA,DR,CSMT', NULL),

('MAS_TO_GTL', 'MAS', 'GTL', 443, 'DOUBLE_LINE', 'EASTERN_GHATS_DECCAN',
 'MAS,PER*,AJJ,RU,KOU*,HX,YA,MOO*,TU,GY*,GTL', NULL),

('MAS_TO_BZA', 'MAS', 'BZA', 431, 'DOUBLE_LINE_HIGH_SPEED', 'EAST_COAST_DELTA',
 'MAS,SPE*,GDR,NLR,KVZ*,OGL,CLX,BPP*,TEL,BZA', NULL),

('DHNE_TO_BZA', 'DHNE', 'BZA', 366, 'SINGLE_LINE_WITH_LOOPS', 'NALLAMALA_COASTAL',
 'DHNE,BMH*,NDL,GID*,CBM,MRK*,VKN*,NRT,GNT,KCC*,BZA', NULL),

('BZA_TO_VSKP', 'BZA', 'VSKP', 350, 'DOUBLE_LINE_HIGH_SPEED', 'GODAVARI_COAST',
 'BZA,EE,TDD*,RJY,SLO,TUNI*,AKP*,DVD*,VSKP', NULL),

('VSKP_TO_HWH', 'VSKP', 'HWH', 880, 'DOUBLE_LINE_HIGH_SPEED', 'EAST_COAST_BENGAL',
 'VSKP,VZM,CHE,PSA,BAM,BALU*,KUR,BBS,CTC,BHC,BLS,KGP,MCA*,SRC,HWH', NULL),

('CSMT_TO_ADI', 'CSMT', 'ADI', 492, 'DOUBLE_LINE_HIGH_SPEED', 'WEST_COAST_GUJARAT',
 'CSMT,DR,BVI,VAPI,ST,BH*,BRC,ANND*,ADI', NULL),

('ADI_TO_JP', 'ADI', 'JP', 620, 'MIXED_SINGLE_DOUBLE', 'ARAVALLI_RAJASTHAN',
 'ADI,MSH,PNU,ABR,FA*,MJ,AII,FL*,JP', NULL),

('JP_TO_NDLS', 'JP', 'NDLS', 308, 'DOUBLE_LINE', 'RAJASTHAN_NCR',
 'JP,DO*,BKI,AWR,RE,GGN,DEC,NDLS', NULL);
