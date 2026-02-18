import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";

const execFileAsync = promisify(execFile);

export class PrCreatorError extends Error {}

export class PrCreator {
  constructor(private readonly repoRoot: string) {}

  async createDraftPr(task: TaskSpec, candidatePath: string): Promise<string> {
    const repoPath = resolveRepoSnapshotPath(this.repoRoot, task.repo);
    if (!fs.existsSync(repoPath)) {
      throw new PrCreatorError(`Repo snapshot not found: ${repoPath}`);
    }

    this.syncCandidateToRepo(candidatePath, repoPath);
    const stack = await this.prepareGitBranch(repoPath, task);

    const title = `chore(agent): ${task.intent}`;
    const body = [
      "Automated by OkayDokki.",
      "",
      `Task ID: ${task.taskId}`,
      `Trigger user: ${task.triggerUser}`,
      "",
      "Stack:",
      `- Strategy: ${task.deliveryStrategy ?? "rolling"}`,
      `- Parent branch: ${stack.parentBranch}`,
      `- Merge order: ${stack.mergeOrder}`
    ].join("\n");

    try {
      const { stdout } = await execFileAsync("gh", [
        "pr",
        "create",
        "--draft",
        "--title",
        title,
        "--body",
        body,
        "--head",
        task.branch
      ], { cwd: repoPath });
      const link = stdout.trim();
      if (!link) {
        throw new PrCreatorError("gh pr create returned empty output");
      }
      return link;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PrCreatorError(`gh pr create failed: ${message}`);
    }
  }

  private syncCandidateToRepo(candidatePath: string, repoPath: string): void {
    const entries = fs.readdirSync(repoPath);
    for (const entry of entries) {
      if (entry === ".git") {
        continue;
      }
      fs.rmSync(path.join(repoPath, entry), { recursive: true, force: true });
    }

    const candidateEntries = fs.readdirSync(candidatePath);
    for (const entry of candidateEntries) {
      if (entry === ".git") {
        continue;
      }
      fs.cpSync(path.join(candidatePath, entry), path.join(repoPath, entry), {
        recursive: true
      });
    }
  }

  private async prepareGitBranch(
    repoPath: string,
    task: TaskSpec
  ): Promise<{ parentBranch: string; mergeOrder: string }> {
    const strategy = task.deliveryStrategy ?? "rolling";
    const baseBranch = task.baseBranch ?? "main";
    let parentBranch = await this.getCurrentBranch(repoPath);
    if (strategy === "isolated") {
      await this.runGitBestEffort(repoPath, ["fetch", "origin", baseBranch]);
      await this.runGit(repoPath, ["checkout", baseBranch]);
      await this.runGitBestEffort(repoPath, ["reset", "--hard", `origin/${baseBranch}`]);
      parentBranch = baseBranch;
    }

    await this.runGit(repoPath, ["checkout", "-B", task.branch]);
    await this.runGit(repoPath, ["add", "-A"]);

    const hasChanges = await this.hasStagedChanges(repoPath);
    if (!hasChanges) {
      throw new PrCreatorError("no staged changes to commit");
    }

    await this.runGit(repoPath, [
      "-c",
      "user.name=OkayDokki Bot",
      "-c",
      "user.email=okaydokki-bot@local",
      "commit",
      "-m",
      `chore(agent): ${task.intent}`
    ]);
    await this.runGit(repoPath, ["push", "-u", "origin", task.branch]);
    return {
      parentBranch,
      mergeOrder:
        strategy === "isolated"
          ? `${task.branch} -> ${baseBranch}`
          : `${parentBranch} -> ${task.branch} -> ${baseBranch}`
    };
  }

  private async hasStagedChanges(repoPath: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: repoPath });
      return false;
    } catch {
      return true;
    }
  }

  private async runGit(repoPath: string, args: string[]): Promise<void> {
    try {
      await execFileAsync("git", args, { cwd: repoPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new PrCreatorError(`git ${args.join(" ")} failed: ${message}`);
    }
  }

  private async runGitBestEffort(repoPath: string, args: string[]): Promise<void> {
    try {
      await execFileAsync("git", args, { cwd: repoPath });
    } catch {
      // best-effort sync for optional remote state
    }
  }

  private async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repoPath
      });
      const branch = stdout.trim();
      return branch || "unknown";
    } catch {
      return "unknown";
    }
  }
}
