CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  contact_info TEXT NOT NULL DEFAULT '',
  main_task TEXT NOT NULL DEFAULT '',
  pain_score INTEGER NOT NULL DEFAULT 0,
  commercial_score INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_responses_created ON responses(created_at);
