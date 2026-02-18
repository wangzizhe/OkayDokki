import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";

const execFileAsync = promisify(execFile);

export interface SandboxExecutionResult {
  diff: string;
  agentLogs: string[];
  agentMeta: Record<string, string>;
  agentExitCode: number;
  testExitCode: number;
  testLog: string;
}

export interface DockerSandboxOptions {
  image: string;
  repoRoot: string;
  allowedTestCommands: string[];
  defaultTestCommand: string;
}

export class DockerSandbox {
  constructor(private readonly options: DockerSandboxOptions) {}

  async runTask(task: TaskSpec, agentCommand: string): Promise<SandboxExecutionResult> {
    const hostRepoPath = this.resolveRepoPath(task.repo);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `okaydokki-${task.taskId}-`));
    const workDir = path.join(tempDir, "work");
    const outDir = path.join(tempDir, "out");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    const testCommand = this.assertAllowedTestCommand(this.options.defaultTestCommand);

    const script = [
      "set -eu",
      "cp -a /repo/. /work",
      "cd /work",
      "AGENT_STATUS=0",
      "sh -lc \"$AGENT_CMD\" > /out/agent.log 2>&1 || AGENT_STATUS=$?",
      "echo \"$AGENT_STATUS\" > /out/agent.exit",
      "diff -ruN /repo /work > /out/patch.diff || true",
      "TEST_STATUS=0",
      "if [ -n \"${TEST_CMD:-}\" ] && [ \"$AGENT_STATUS\" -eq 0 ]; then",
      "  sh -lc \"$TEST_CMD\" > /out/test.log 2>&1 || TEST_STATUS=$?",
      "else",
      "  echo \"test skipped\" > /out/test.log",
      "fi",
      "echo \"$TEST_STATUS\" > /out/test.exit"
    ].join("\n");

    let dockerError: unknown = null;
    try {
      await execFileAsync("docker", [
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${hostRepoPath}:/repo:ro`,
        "-v",
        `${workDir}:/work`,
        "-v",
        `${outDir}:/out`,
      "-e",
      `AGENT_CMD=${agentCommand}`,
      "-e",
      `TEST_CMD=${testCommand}`,
      "-e",
      `OKD_TASK_ID=${task.taskId}`,
      "-e",
      `OKD_REPO=${task.repo}`,
      "-e",
      `OKD_BRANCH=${task.branch}`,
      "-e",
      `OKD_TRIGGER_USER=${task.triggerUser}`,
      "-e",
      `OKD_INTENT=${task.intent}`,
      "-e",
      "OKD_WORKDIR=/work",
      "-e",
      "OKD_OUTDIR=/out",
      this.options.image,
      "sh",
      "-lc",
      script
      ]);
    } catch (err) {
      dockerError = err;
    }

    const diff = this.readFileSafe(path.join(outDir, "patch.diff"));
    const agentLog = this.readFileSafe(path.join(outDir, "agent.log"));
    const agentMeta = this.readJsonObject(path.join(outDir, "agent.meta.json"));
    const testLog = this.readFileSafe(path.join(outDir, "test.log"));
    const agentExitCode = Number(this.readFileSafe(path.join(outDir, "agent.exit")).trim() || "1");
    const testExitCode = Number(this.readFileSafe(path.join(outDir, "test.exit")).trim() || "1");

    fs.rmSync(tempDir, { recursive: true, force: true });

    if (dockerError) {
      const msg = dockerError instanceof Error ? dockerError.message : String(dockerError);
      throw new Error(`Docker sandbox execution failed: ${msg}`);
    }

    return {
      diff,
      agentLogs: agentLog ? [agentLog] : [],
      agentMeta,
      agentExitCode,
      testExitCode,
      testLog
    };
  }

  private resolveRepoPath(repo: string): string {
    const resolved = resolveRepoSnapshotPath(this.options.repoRoot, repo);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Repo snapshot not found: ${resolved}`);
    }
    return resolved;
  }

  private assertAllowedTestCommand(command: string): string {
    if (!this.options.allowedTestCommands.includes(command)) {
      throw new Error(`Test command is not allowed: ${command}`);
    }
    return command;
  }

  private readFileSafe(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }

  private readJsonObject(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          out[key] = value;
        }
      }
      return out;
    } catch {
      return {};
    }
  }
}
