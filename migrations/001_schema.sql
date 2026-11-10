CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS list_statuses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_assignments (
  user_id INTEGER NOT NULL,
  status_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, status_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (status_id) REFERENCES list_statuses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  sheet_row_index INTEGER,
  prospect_key TEXT NOT NULL,
  prospect_id TEXT,
  lead_id TEXT,
  phone TEXT,
  name TEXT,
  address TEXT,
  status TEXT,
  date_col TEXT,
  appointment_date TEXT,
  meeting_time TEXT,
  team TEXT,
  project TEXT,
  agent TEXT,
  source TEXT,
  language TEXT,
  notes TEXT,
  notes_followups TEXT,
  ownership TEXT,
  recovery_agent TEXT,
  challenge TEXT,
  sales_amount TEXT,
  meeting_id TEXT,
  calendar_event_id TEXT,
  welcome_call TEXT,
  confirmed TEXT,
  paid TEXT,
  is_dnc INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sheet_row_index, prospect_key)
);

CREATE INDEX IF NOT EXISTS idx_leads_prospect ON leads(prospect_key);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);

CREATE TABLE IF NOT EXISTS call_attempts (
  id SERIAL PRIMARY KEY,
  lead_id INTEGER NOT NULL,
  prospect_key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  notes TEXT,
  agent_user_id INTEGER NOT NULL,
  agent_display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_prospect ON call_attempts(prospect_key);
CREATE INDEX IF NOT EXISTS idx_attempts_lead ON call_attempts(lead_id);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_attempt_assignments (
  user_id INTEGER NOT NULL,
  bucket TEXT NOT NULL,
  PRIMARY KEY (user_id, bucket),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
