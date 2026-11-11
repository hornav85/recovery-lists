CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  rate_key TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_key_time
  ON login_attempts (rate_key, attempted_at);
