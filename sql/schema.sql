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

