-- liquibase formatted sql
-- changeset railsim:007-users-and-career
-- Player accounts (email login), sessions and the saved career.
CREATE TABLE app_users (
    id            BIGSERIAL PRIMARY KEY,
    email         VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE career_profiles (
    user_id    BIGINT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    data_json  TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- default account (PBKDF2-SHA256, 120000 iterations)
INSERT INTO app_users (email, password_hash) VALUES ('siddu.ms19@gmail.com', 'pbkdf2$120000$wahOGguoZyBFPfcPrl9TsQ==$V8ZoVAtFhSuVxYsndg/gkQF5/fzkQIQ1knwveU0Fnx0=');
