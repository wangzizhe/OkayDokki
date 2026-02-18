import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface SqliteDb {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    all: (...params: unknown[]) => unknown[];
  };
}

export function createDb(): SqliteDb {
  return new Database(config.dbPath);
}

export function initDb(db: SqliteDb): void {
  const schemaPath = path.resolve(process.cwd(), "sql/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  ensureTaskColumns(db);
}

function ensureTaskColumns(db: SqliteDb): void {
  const rows = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name?: string }>;
  const columns = new Set(rows.map((r) => String(r.name ?? "")));

  if (!columns.has("delivery_strategy")) {
    db.exec("ALTER TABLE tasks ADD COLUMN delivery_strategy TEXT NOT NULL DEFAULT 'rolling'");
  }
  if (!columns.has("base_branch")) {
    db.exec("ALTER TABLE tasks ADD COLUMN base_branch TEXT NOT NULL DEFAULT 'main'");
  }
}
