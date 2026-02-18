import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";

const execFileAsync = promisify(execFile);

export interface HostAgentExecutionResult {
  diff: string;
  agentLogs: string[];
  agentMeta: Record<string, string>;
  candidatePath: string;
  cleanup: () => void;
}

export class HostAgentExecutor {
  constructor(private readonly repoRoot: string) {}

  async run(task: TaskSpec, agentCommand: string): Promise<HostAgentExecutionResult> {
    const repoPath = resolveRepoSnapshotPath(this.repoRoot, task.repo);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repo snapshot not found: ${repoPath}`);
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `okd-host-${task.taskId}-`));
    const workDir = path.join(tempDir, "work");
    const outDir = path.join(tempDir, "out");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(repoPath, workDir, { recursive: true });

    try {
      await execFileAsync("sh", ["-lc", agentCommand], {
        cwd: workDir,
        env: {
          ...process.env,
          OKD_TASK_ID: task.taskId,
          OKD_REPO: task.repo,
          OKD_BRANCH: task.branch,
          OKD_TRIGGER_USER: task.triggerUser,
          OKD_INTENT: task.intent,
          OKD_WORKDIR: workDir,
          OKD_OUTDIR: outDir
        }
      });
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string };
      const details = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n");
      this.cleanupTemp(tempDir);
      throw new Error(details || "agent command failed");
    }

    const diff = await this.diffRepo(repoPath, workDir);
    const agentLog = this.readFileSafe(path.join(outDir, "agent.log"));
    const agentMeta = this.readJsonObject(path.join(outDir, "agent.meta.json"));

    return {
      diff,
      agentLogs: agentLog ? [agentLog] : [],
      agentMeta,
      candidatePath: workDir,
      cleanup: () => this.cleanupTemp(tempDir)
    };
  }

  private async diffRepo(original: string, candidate: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("diff", ["-ruN", original, candidate]);
      return stdout;
    } catch (err) {
      const error = err as { code?: number; stdout?: string; message?: string };
      if (error.code === 1) {
        return error.stdout ?? "";
      }
      throw new Error(error.message ?? "failed to produce diff");
    }
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

  private cleanupTemp(tempDir: string): void {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
