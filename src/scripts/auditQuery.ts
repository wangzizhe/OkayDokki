import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

type AuditRow = {
  timestamp?: string;
  taskId?: string;
  eventType?: string;
  errorCode?: string;
  testsResult?: string;
  prLink?: string;
  message?: string;
};

function usage(): void {
  console.error("Usage: npm run audit:task -- <task_id>");
}

function main(): void {
  const taskId = process.argv[2];
  if (!taskId) {
    usage();
    process.exit(1);
  }

  const logPath = process.env.AUDIT_LOG_PATH ?? "./audit.jsonl";
  const resolved = path.resolve(logPath);
  if (!fs.existsSync(resolved)) {
    console.error(`audit log not found: ${resolved}`);
    process.exit(1);
  }

  const lines = fs
    .readFileSync(resolved, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: AuditRow[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as AuditRow;
      if (row.taskId === taskId) {
        rows.push(row);
      }
    } catch {
      // ignore malformed lines
    }
  }

  if (rows.length === 0) {
    console.log(`no audit records found for task: ${taskId}`);
    return;
  }

  rows.sort((a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")));
  console.log(`Task ${taskId} audit timeline (${rows.length} event${rows.length > 1 ? "s" : ""})`);
  for (const row of rows) {
    const parts = [
      row.timestamp ?? "unknown-time",
      row.eventType ?? "UNKNOWN"
    ];
    if (row.errorCode) {
      parts.push(`code=${row.errorCode}`);
    }
    if (row.testsResult) {
      parts.push(`tests=${row.testsResult}`);
    }
    if (row.prLink) {
      parts.push(`pr=${row.prLink}`);
    }
    if (row.message) {
      parts.push(`msg=${row.message}`);
    }
    console.log(`- ${parts.join(" | ")}`);
  }
}

main();
