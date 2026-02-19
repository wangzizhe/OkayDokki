import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

dotenv.config();

type Level = "PASS" | "WARN" | "FAIL";

type CheckResult = {
  name: string;
  level: Level;
  message: string;
};

function runCheck(name: string, fn: () => CheckResult): CheckResult {
  try {
    return fn();
  } catch (err) {
    return {
      name,
      level: "FAIL",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

function ok(name: string, message: string): CheckResult {
  return { name, level: "PASS", message };
}

function warn(name: string, message: string): CheckResult {
  return { name, level: "WARN", message };
}

function fail(name: string, message: string): CheckResult {
  return { name, level: "FAIL", message };
}

function runCmd(bin: string, args: string[]): { status: number | null; stderr: string; stdout: string } {
  const out = spawnSync(bin, args, {
    encoding: "utf8"
  });
  return {
    status: out.status,
    stderr: out.stderr ?? "",
    stdout: out.stdout ?? ""
  };
}

function requiredEnv(name: string): CheckResult {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return fail(name, "missing");
  }
  if (value.includes("replace_me")) {
    return fail(name, "placeholder value detected");
  }
  return ok(name, "configured");
}

function optionalEnvNotPlaceholder(name: string): CheckResult {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return warn(name, "empty");
  }
  if (value.includes("replace_me")) {
    return fail(name, "placeholder value detected");
  }
  return ok(name, "configured");
}

function checkDocker(): CheckResult {
  const res = runCmd("docker", ["--version"]);
  if (res.status !== 0) {
    return fail("docker", `unavailable (${res.stderr.trim() || "exit non-zero"})`);
  }
  return ok("docker", res.stdout.trim());
}

function checkGh(): CheckResult {
  const ver = runCmd("gh", ["--version"]);
  if (ver.status !== 0) {
    return fail("gh", `unavailable (${ver.stderr.trim() || "exit non-zero"})`);
  }
  const auth = runCmd("gh", ["auth", "status", "-h", "github.com"]);
  if (auth.status !== 0) {
    return fail("gh auth", "not logged in. Run: gh auth login");
  }
  return ok("gh auth", "authenticated");
}

function checkRepoRootAndDefaultRepo(): CheckResult[] {
  const rootRaw = process.env.REPO_SNAPSHOT_ROOT ?? "./repos";
  const root = path.resolve(rootRaw);
  const out: CheckResult[] = [];

  if (!fs.existsSync(root)) {
    out.push(fail("repo root", `missing: ${root}`));
    return out;
  }
  out.push(ok("repo root", root));

  const defaultRepo = process.env.DEFAULT_REPO ?? "org/name";
  if (defaultRepo === "org/name" || defaultRepo.includes("placeholder")) {
    out.push(warn("default repo", `placeholder-like value: ${defaultRepo}`));
    return out;
  }

  const defaultRepoPath = path.resolve(root, defaultRepo);
  if (!defaultRepoPath.startsWith(root)) {
    out.push(fail("default repo", `invalid path: ${defaultRepo}`));
    return out;
  }
  if (!fs.existsSync(defaultRepoPath)) {
    out.push(warn("default repo", `snapshot missing: ${defaultRepoPath}`));
    return out;
  }
  out.push(ok("default repo", defaultRepoPath));
  return out;
}

function checkAgentTemplate(): CheckResult {
  const value = process.env.AGENT_CLI_TEMPLATE;
  if (!value || value.trim() === "") {
    return fail("AGENT_CLI_TEMPLATE", "missing");
  }
  if (!value.includes("$OKD_INTENT")) {
    return warn("AGENT_CLI_TEMPLATE", "does not reference $OKD_INTENT");
  }
  return ok("AGENT_CLI_TEMPLATE", "configured");
}

function parseAgentAuthMode(): CheckResult | { mode: "session" | "api" } {
  const raw = process.env.AGENT_AUTH_MODE ?? "session";
  const mode = raw.trim().toLowerCase();
  if (mode !== "session" && mode !== "api") {
    return fail("AGENT_AUTH_MODE", `invalid value '${raw}', expected session or api`);
  }
  return { mode };
}

function parseAgentProvider(): CheckResult | { mode: "codex" | "claude" | "gemini" } {
  const raw = process.env.AGENT_PROVIDER ?? "codex";
  const mode = raw.trim().toLowerCase();
  if (mode !== "codex" && mode !== "claude" && mode !== "gemini") {
    return fail("AGENT_PROVIDER", `invalid value '${raw}', expected codex, claude, or gemini`);
  }
  return { mode: mode as "codex" | "claude" | "gemini" };
}

function extractCommandBinary(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }
  const first = trimmed.split(/\s+/)[0] ?? "";
  if (!first || first.includes("=") || first === "sh" || first === "bash") {
    return null;
  }
  return first;
}

function checkAgentCliAvailable(): CheckResult {
  const template = process.env.AGENT_CLI_TEMPLATE ?? "";
  const bin = extractCommandBinary(template);
  if (!bin) {
    return warn("agent cli", "cannot infer CLI binary from AGENT_CLI_TEMPLATE");
  }
  const shellBuiltins = new Set(["printf", "echo", "cd", "test", "true", "false", "export"]);
  if (shellBuiltins.has(bin)) {
    return warn("agent cli", `${bin} is a shell builtin (placeholder or wrapper command)`);
  }
  const res = runCmd(bin, ["--version"]);
  if (res.status !== 0) {
    return fail("agent cli", `${bin} unavailable or --version failed`);
  }
  const line = (res.stdout || res.stderr).trim().split("\n")[0] ?? "";
  return ok("agent cli", `${bin}: ${line}`);
}

function checkChatTemplate(provider: "codex" | "claude" | "gemini"): CheckResult {
  const value = (process.env.CHAT_CLI_TEMPLATE ?? "").trim();
  if (value) {
    if (!value.includes("{{prompt}}")) {
      return warn("CHAT_CLI_TEMPLATE", "configured but missing {{prompt}} placeholder");
    }
    return ok("CHAT_CLI_TEMPLATE", "configured");
  }
  return ok("CHAT_CLI_TEMPLATE", `not set (using built-in ${provider} chat invocation)`);
}

function checkAgentSessionAuth(): CheckResult {
  const cmd = process.env.AGENT_SESSION_CHECK_CMD?.trim();
  if (!cmd) {
    return warn(
      "agent session auth",
      "AGENT_SESSION_CHECK_CMD not set; skip login-state verification"
    );
  }
  const out = spawnSync("sh", ["-lc", cmd], {
    encoding: "utf8"
  });
  if (out.status !== 0) {
    const msg = (out.stderr || out.stdout || "exit non-zero").trim();
    return fail("agent session auth", msg);
  }
  const line = (out.stdout || out.stderr || "ok").trim().split("\n")[0] ?? "ok";
  return ok("agent session auth", line);
}

function parseTelegramMode(): CheckResult | { mode: "polling" | "webhook" } {
  const raw = process.env.TELEGRAM_MODE ?? "polling";
  const mode = raw.trim().toLowerCase();
  if (mode !== "polling" && mode !== "webhook") {
    return fail("TELEGRAM_MODE", `invalid value '${raw}', expected polling or webhook`);
  }
  return { mode };
}

function parseDeliveryStrategy(): CheckResult | { mode: "rolling" | "isolated" } {
  const raw = process.env.DELIVERY_STRATEGY ?? "rolling";
  const mode = raw.trim().toLowerCase();
  if (mode !== "rolling" && mode !== "isolated") {
    return fail("DELIVERY_STRATEGY", `invalid value '${raw}', expected rolling or isolated`);
  }
  return { mode };
}

function checkBaseBranch(): CheckResult {
  const branch = (process.env.BASE_BRANCH ?? "main").trim();
  if (!branch) {
    return fail("BASE_BRANCH", "empty");
  }
  return ok("BASE_BRANCH", branch);
}

function optionalEnvForPolling(name: string): CheckResult {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    return ok(name, "not required in polling mode");
  }
  if (value.includes("replace_me")) {
    return fail(name, "placeholder value detected");
  }
  return ok(name, "configured");
}

function printResults(results: CheckResult[]): void {
  process.stdout.write("OkayDokki preflight\n");
  for (const r of results) {
    process.stdout.write(`[${r.level}] ${r.name}: ${r.message}\n`);
  }
  const failCount = results.filter((r) => r.level === "FAIL").length;
  const warnCount = results.filter((r) => r.level === "WARN").length;
  process.stdout.write(`\nSummary: ${results.length} checks, ${failCount} failed, ${warnCount} warning(s)\n`);
}

function main(): void {
  const modeResult = parseTelegramMode();
  const authModeResult = parseAgentAuthMode();
  const providerResult = parseAgentProvider();
  const deliveryResult = parseDeliveryStrategy();
  const results: CheckResult[] = [];
  if ("level" in modeResult) {
    results.push(modeResult);
  } else {
    results.push(ok("TELEGRAM_MODE", modeResult.mode));
  }
  if ("level" in authModeResult) {
    results.push(authModeResult);
  } else {
    results.push(ok("AGENT_AUTH_MODE", authModeResult.mode));
  }
  if ("level" in providerResult) {
    results.push(providerResult);
  } else {
    results.push(ok("AGENT_PROVIDER", providerResult.mode));
  }
  if ("level" in deliveryResult) {
    results.push(deliveryResult);
  } else {
    results.push(ok("DELIVERY_STRATEGY", deliveryResult.mode));
  }
  results.push(runCheck("BASE_BRANCH", checkBaseBranch));

  results.push(
    runCheck("TELEGRAM_BOT_TOKEN", () => requiredEnv("TELEGRAM_BOT_TOKEN")),
    runCheck("AGENT_CLI_TEMPLATE", checkAgentTemplate),
    runCheck("agent cli", checkAgentCliAvailable),
    runCheck("CHAT_CLI_TEMPLATE", () =>
      checkChatTemplate("mode" in providerResult ? providerResult.mode : "codex")
    ),
    runCheck("DATABASE_PATH", () => optionalEnvNotPlaceholder("DATABASE_PATH")),
    runCheck("docker", checkDocker),
    runCheck("gh", checkGh)
  );

  const authMode = "mode" in authModeResult ? authModeResult.mode : "session";
  if (authMode === "session") {
    results.push(runCheck("agent session auth", checkAgentSessionAuth));
  } else {
    results.push(ok("agent session auth", "not required in api mode"));
  }

  const mode = "mode" in modeResult ? modeResult.mode : "polling";
  if (mode === "webhook") {
    results.push(
      runCheck("TELEGRAM_WEBHOOK_SECRET", () => requiredEnv("TELEGRAM_WEBHOOK_SECRET")),
      runCheck("BASE_URL", () => requiredEnv("BASE_URL"))
    );
  } else {
    results.push(
      runCheck("TELEGRAM_WEBHOOK_SECRET", () => optionalEnvForPolling("TELEGRAM_WEBHOOK_SECRET")),
      runCheck("BASE_URL", () => optionalEnvForPolling("BASE_URL"))
    );
  }

  results.push(...checkRepoRootAndDefaultRepo());

  printResults(results);
  const hasFail = results.some((r) => r.level === "FAIL");
  process.exit(hasFail ? 1 : 0);
}

main();
