import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";

const execFileAsync = promisify(execFile);

export class PrCreatorError extends Error {}

export class PrCreator {
  async createDraftPr(task: TaskSpec): Promise<string> {
    const title = `chore(agent): ${task.intent}`;
    const body = [
      "Automated by OkayDokki.",
      "",
      `Task ID: ${task.taskId}`,
      `Trigger user: ${task.triggerUser}`
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
      ]);
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
}
