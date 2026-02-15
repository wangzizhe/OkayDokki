import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return defaultValue;
}

export const config = {
  port: Number(process.env.PORT ?? "3000"),
  dbPath: process.env.DATABASE_PATH ?? "./okaydokki.db",
  auditLogPath: process.env.AUDIT_LOG_PATH ?? "./audit.jsonl",
  repoSnapshotRoot: process.env.REPO_SNAPSHOT_ROOT ?? "./repos",
  sandboxImage: process.env.SANDBOX_IMAGE ?? "node:22-bookworm-slim",
  defaultTestCommand: process.env.DEFAULT_TEST_COMMAND ?? "npm test",
  allowedTestCommands: (process.env.ALLOWED_TEST_COMMANDS ?? "npm test")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
  blockedPathPrefixes: (process.env.BLOCKED_PATH_PREFIXES ?? ".github/workflows/,secrets/")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
  maxChangedFiles: Number(process.env.MAX_CHANGED_FILES ?? "200"),
  maxDiffBytes: Number(process.env.MAX_DIFF_BYTES ?? "500000"),
  disallowBinaryPatch: parseBoolean(process.env.DISALLOW_BINARY_PATCH, true),
  agentCliTemplate:
    process.env.AGENT_CLI_TEMPLATE ??
    "printf 'agent placeholder for %s\\n' \"$OKD_INTENT\" && touch .okaydokki-agent && printf '{\"engine\":\"codex\",\"protocol\":\"v1\"}\\n' > \"$OKD_OUTDIR/agent.meta.json\"",
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  baseUrl: required("BASE_URL"),
  defaultRepo: process.env.DEFAULT_REPO ?? "org/name"
};
