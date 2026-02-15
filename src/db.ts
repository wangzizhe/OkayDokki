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
}
