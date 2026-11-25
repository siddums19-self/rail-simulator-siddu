-- liquibase formatted sql
-- changeset railsim:013-game-scores
-- One row per finished game (train driving, station master, section controller, wayside station master)
-- for the daily / weekly / monthly top-10 leaderboards. Guests post under the name they chose.
CREATE TABLE game_scores (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
    player_name VARCHAR(40)  NOT NULL,
    mode        VARCHAR(20)  NOT NULL,
    venue       VARCHAR(40)  NOT NULL DEFAULT '',
    score       INTEGER      NOT NULL,
    trains      INTEGER      NOT NULL DEFAULT 0,
    avg_delay   REAL,
    guest       BOOLEAN      NOT NULL DEFAULT TRUE,
    played_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_game_scores_mode_time ON game_scores(mode, played_at);
