CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  source_im TEXT NOT NULL,
  trigger_user TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  intent TEXT NOT NULL,
  agent TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  approved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  repo TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages(chat_id, user_id, created_at);
