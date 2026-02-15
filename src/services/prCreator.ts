import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";

const execFileAsync = promisify(execFile);

export class PrCreator {
  async createDraftPr(task: TaskSpec): Promise<string | null> {
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
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

