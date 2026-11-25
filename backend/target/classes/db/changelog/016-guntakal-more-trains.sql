-- liquibase formatted sql
-- changeset railsim:016-guntakal-more-trains
-- More Station Master traffic at Guntakal on the Dhone line, the Anantapur direct line and the Ballari line.
INSERT INTO sm_station_trains (station_code, train_no, train_name, kind, from_line, to_line, reverses) VALUES
('GTL', '17603', 'Kacheguda–Yelahanka Exp', 'exp', 'DHNE', 'GY', FALSE),
('GTL', '17604', 'Yelahanka–Kacheguda Exp', 'exp', 'GY', 'DHNE', FALSE),
('GTL', '12797', 'Venkatadri Exp', 'exp', 'DHNE', 'GY', FALSE),
('GTL', '12798', 'Venkatadri Exp', 'exp', 'GY', 'DHNE', FALSE),
('GTL', '57471', 'Guntakal–Kacheguda Passenger', 'pass', 'AD', 'DHNE', FALSE),
('GTL', '57472', 'Kacheguda–Guntakal Passenger', 'pass', 'DHNE', 'BAY', FALSE),
('GTL', 'BOXN', 'Cement rake (Dhone)', 'goods', 'DHNE', 'GY', FALSE),
('GTL', '07419', 'Guntakal–Dharmavaram DEMU', 'pass', 'AD', 'ATP', FALSE),
('GTL', '07420', 'Dharmavaram–Guntakal DEMU', 'pass', 'ATP', 'BAY', FALSE),
('GTL', '17211', 'Machilipatnam–Dharmavaram Exp', 'exp', 'DHNE', 'ATP', TRUE),
('GTL', '17212', 'Dharmavaram–Machilipatnam Exp', 'exp', 'ATP', 'DHNE', TRUE),
('GTL', 'BOXN', 'Iron ore rake (Anantapur)', 'goods', 'ATP', 'BAY', FALSE),
('GTL', '17415', 'Haripriya Exp', 'exp', 'BAY', 'GY', FALSE),
('GTL', '17416', 'Haripriya Exp', 'exp', 'GY', 'BAY', FALSE),
('GTL', '07563', 'Ballari–Guntakal DEMU', 'pass', 'BAY', 'DHNE', FALSE),
('GTL', '07564', 'Guntakal–Hosapete DEMU', 'pass', 'DHNE', 'BAY', FALSE),
('GTL', 'BOXN', 'Iron ore rake (Hosapete)', 'goods', 'BAY', 'DHNE', FALSE);
