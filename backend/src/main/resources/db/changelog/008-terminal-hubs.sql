-- liquibase formatted sql
-- changeset railsim:008-terminal-hubs
-- Terminus stations: tracks end at buffer stops, so a train can start, end or reverse
-- there but never run through. (Kacheguda is a through station.)
ALTER TABLE rail_hubs ADD COLUMN terminal BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE rail_hubs SET terminal = TRUE WHERE code IN ('HWH', 'HYB', 'MAS', 'CSMT');
