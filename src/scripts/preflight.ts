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
  const results: CheckResult[] = [
    runCheck("TELEGRAM_BOT_TOKEN", () => requiredEnv("TELEGRAM_BOT_TOKEN")),
    runCheck("TELEGRAM_WEBHOOK_SECRET", () => requiredEnv("TELEGRAM_WEBHOOK_SECRET")),
    runCheck("BASE_URL", () => requiredEnv("BASE_URL")),
    runCheck("AGENT_CLI_TEMPLATE", checkAgentTemplate),
    runCheck("DATABASE_PATH", () => optionalEnvNotPlaceholder("DATABASE_PATH")),
    runCheck("docker", checkDocker),
    runCheck("gh", checkGh),
    ...checkRepoRootAndDefaultRepo()
  ];

  printResults(results);
  const hasFail = results.some((r) => r.level === "FAIL");
  process.exit(hasFail ? 1 : 0);
}

main();

