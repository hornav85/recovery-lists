CREATE TABLE IF NOT EXISTS assignment_snapshots (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  snapshot_at TEXT NOT NULL,
  status_names_json TEXT NOT NULL,
  attempt_buckets_json TEXT NOT NULL,
  by_admin_id INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (by_admin_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_assign_snap_user_at
  ON assignment_snapshots(user_id, snapshot_at);
