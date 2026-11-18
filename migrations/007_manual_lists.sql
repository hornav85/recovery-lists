CREATE TABLE IF NOT EXISTS manual_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  columns_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_lists_name_lower ON manual_lists (LOWER(name));

CREATE TABLE IF NOT EXISTS manual_list_rows (
  id SERIAL PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES manual_lists(id) ON DELETE CASCADE,
  prospect_key TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (list_id, prospect_key)
);

CREATE INDEX IF NOT EXISTS idx_manual_rows_list ON manual_list_rows(list_id);

CREATE TABLE IF NOT EXISTS manual_list_assignments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id INTEGER NOT NULL REFERENCES manual_lists(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, list_id)
);

CREATE TABLE IF NOT EXISTS manual_attempts (
  id SERIAL PRIMARY KEY,
  row_id INTEGER REFERENCES manual_list_rows(id) ON DELETE SET NULL,
  list_id INTEGER REFERENCES manual_lists(id) ON DELETE SET NULL,
  list_name TEXT NOT NULL,
  prospect_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  agent_user_id INTEGER NOT NULL REFERENCES users(id),
  agent_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manual_attempts_list ON manual_attempts(list_id, prospect_key);
CREATE INDEX IF NOT EXISTS idx_manual_attempts_created ON manual_attempts(created_at);

ALTER TABLE assignment_snapshots
  ADD COLUMN IF NOT EXISTS manual_list_names_json TEXT NOT NULL DEFAULT '[]';
