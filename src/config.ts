import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
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
  agentCliTemplate:
    process.env.AGENT_CLI_TEMPLATE ??
    "printf 'agent placeholder for %s\\n' \"$OKD_INTENT\" && touch .okaydokki-agent && printf '{\"engine\":\"codex\",\"protocol\":\"v1\"}\\n' > \"$OKD_OUTDIR/agent.meta.json\"",
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramWebhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  baseUrl: required("BASE_URL"),
  defaultRepo: process.env.DEFAULT_REPO ?? "org/name"
};
