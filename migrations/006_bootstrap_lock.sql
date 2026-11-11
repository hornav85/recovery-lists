-- Offline first-admin guard (id must be 1). No HTTP bootstrap route.
CREATE TABLE IF NOT EXISTS app_bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  completed_at TEXT NOT NULL,
  admin_user_id INTEGER REFERENCES users(id)
);
