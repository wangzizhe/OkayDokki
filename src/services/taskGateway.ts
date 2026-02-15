import { IMAdapter } from "../adapters/im/imAdapter.js";
import { config } from "../config.js";
import { TaskAction, TaskService, TaskServiceError } from "./taskService.js";

function parseTaskCommand(text: string): { repo: string; intent: string } {
  const trimmed = text.trim();
  const repoMatch = trimmed.match(/repo=([^\s]+)/);
  const repo = repoMatch?.[1] ?? config.defaultRepo;
  const intent = trimmed.replace(/^\/task/, "").replace(/repo=[^\s]+/, "").trim();
  if (!intent) {
    throw new Error("Intent is required. Example: /task repo=org/name fix login 500");
  }
  return { repo, intent };
}

function parseAction(raw: string): { action: TaskAction; taskId: string } {
  const [prefix, taskId] = raw.split(":");
  if (!taskId) {
    throw new Error("Invalid callback payload.");
  }
  if (prefix === "rty") {
    return { action: "retry", taskId };
  }
  if (prefix === "apv") {
    return { action: "approve", taskId };
  }
  if (prefix === "rej") {
    return { action: "reject", taskId };
  }
  throw new Error(`Unsupported callback: ${prefix}`);
}

export class TaskGateway {
  constructor(
    private readonly im: IMAdapter,
    private readonly service: TaskService
  ) {}

  bindHandlers(): void {
    this.im.onTaskCommand(async (chatId, userId, text) => {
      await this.handleTask(chatId, userId, text);
    });
    this.im.onCallback(async (chatId, userId, data) => {
      await this.handleCallback(chatId, userId, data);
    });
  }

  private async handleTask(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parseTaskCommand(text);
      const result = this.service.createTask({
        source: "telegram",
        triggerUser: `tg:${userId}`,
        repo: parsed.repo,
        intent: parsed.intent,
        agent: "codex"
      });

      if (result.needsClarify) {
        await this.im.sendMessage(
          chatId,
          [
            `Task parsed: ${result.task.intent}`,
            "Status: WAIT_CLARIFY",
            `Missing repo snapshot for '${result.task.repo}'.`,
            `Expected path: ${result.expectedPath ?? "n/a"}`,
            "Prepare the snapshot, then tap Retry."
          ].join("\n"),
          [[{ text: "Retry", callbackData: `rty:${result.task.taskId}` }]]
        );
        return;
      }

      await this.im.sendMessage(
        chatId,
        `Task parsed: ${result.task.intent}\nStatus: WAIT_APPROVE_WRITE`
      );
      await this.sendApprovalButtons(chatId, result.task.taskId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to parse task command."
      );
    }
  }

  private async handleCallback(chatId: string, userId: string, data: string): Promise<void> {
    try {
      const { action, taskId } = parseAction(data);
      const result = await this.service.applyAction(taskId, action, `tg:${userId}`);

      if (action === "retry") {
        await this.im.sendMessage(chatId, `Task ${taskId} moved to WAIT_APPROVE_WRITE.`);
        await this.sendApprovalButtons(chatId, taskId);
        return;
      }

      if (action === "reject") {
        await this.im.sendMessage(chatId, `Task ${taskId} rejected.`);
        return;
      }

      await this.im.sendMessage(
        chatId,
        `Task ${taskId} completed.\nTests: ${result.runResult?.testsResult ?? "unknown"}\nPR: ${result.runResult?.prLink ?? "not created"}`
      );
    } catch (err) {
      if (err instanceof TaskServiceError && err.statusCode === 500) {
        const taskId = data.split(":")[1];
        await this.im.sendMessage(chatId, `Task ${taskId} failed.`);
        return;
      }
      await this.im.sendMessage(chatId, err instanceof Error ? err.message : "Callback handling failed.");
    }
  }

  private async sendApprovalButtons(chatId: string, taskId: string): Promise<void> {
    await this.im.sendMessage(chatId, "Approve write and run?", [
      [
        { text: "Approve", callbackData: `apv:${taskId}` },
        { text: "Reject", callbackData: `rej:${taskId}` }
      ]
    ]);
  }
}

