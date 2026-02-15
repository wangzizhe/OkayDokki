import { AgentAdapter } from "./agentAdapter.js";
import { TaskSpec } from "../../types.js";

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export class CliAgentAdapter implements AgentAdapter {
  constructor(private readonly template: string) {}

  buildCommand(task: TaskSpec): string {
    const map: Record<string, string> = {
      task_id: task.taskId,
      intent: task.intent,
      repo: task.repo,
      branch: task.branch,
      trigger_user: task.triggerUser
    };

    return this.template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
      const raw = map[key];
      if (raw === undefined) {
        throw new Error(`Unknown template key: ${key}`);
      }
      return shellEscape(raw);
    });
  }
}

