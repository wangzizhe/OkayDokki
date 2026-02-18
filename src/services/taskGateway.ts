import { IMAdapter } from "../adapters/im/imAdapter.js";
import { config } from "../config.js";
import { TaskAction, TaskService, TaskServiceError } from "./taskService.js";
import { ChatService } from "./chatService.js";

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

function parseRerunCommand(text: string): { taskId: string } {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Usage: /rerun <task_id>");
  }
  return { taskId: parts[1] };
}

function parseChatCommand(text: string): { repo: string; prompt: string; reset: boolean } {
  const trimmed = text.trim();
  if (/^\/chat\s+reset$/i.test(trimmed)) {
    return {
      repo: config.defaultRepo,
      prompt: "",
      reset: true
    };
  }
  const repoMatch = trimmed.match(/repo=([^\s]+)/);
  const repo = repoMatch?.[1] ?? config.defaultRepo;
  const prompt = trimmed.replace(/^\/chat/, "").replace(/repo=[^\s]+/, "").trim();
  if (!prompt) {
    throw new Error(
      "Prompt is required. Example: /chat repo=okd-sandbox How should I refactor auth middleware?"
    );
  }
  return { repo, prompt, reset: false };
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
    private readonly service: TaskService,
    private readonly chat: ChatService
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
    if (text.startsWith("/chat")) {
      await this.handleChat(chatId, userId, text);
      return;
    }

    if (text.startsWith("/rerun")) {
      await this.handleRerun(chatId, userId, text);
      return;
    }
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
      await this.im.sendMessage(chatId, this.buildApprovalSummary(result.task.taskId));
      await this.sendApprovalButtons(chatId, result.task.taskId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to parse task command."
      );
    }
  }

  private async handleChat(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parseChatCommand(text);
      if (parsed.reset) {
        this.chat.reset(chatId, `tg:${userId}`);
        await this.im.sendMessage(chatId, "Chat memory cleared for this session.");
        return;
      }
      await this.im.sendMessage(chatId, "Chat accepted. Thinking...");
      void this.handleChatAsync(chatId, userId, parsed.repo, parsed.prompt);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to parse chat command."
      );
    }
  }

  private async handleChatAsync(
    chatId: string,
    userId: string,
    repo: string,
      prompt: string
  ): Promise<void> {
    try {
      const response = await this.chat.ask(chatId, `tg:${userId}`, prompt, repo);
      await this.im.sendMessage(chatId, response);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        `Chat failed for tg:${userId}. ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleRerun(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parseRerunCommand(text);
      const rerun = this.service.rerunTask(parsed.taskId, `tg:${userId}`, "telegram");
      if (rerun.needsClarify) {
        await this.im.sendMessage(
          chatId,
          [
            `Rerun created from: ${parsed.taskId}`,
            `New task: ${rerun.task.taskId}`,
            "Status: WAIT_CLARIFY",
            `Missing repo snapshot for '${rerun.task.repo}'.`,
            `Expected path: ${rerun.expectedPath ?? "n/a"}`,
            "Prepare the snapshot, then tap Retry."
          ].join("\n"),
          [[{ text: "Retry", callbackData: `rty:${rerun.task.taskId}` }]]
        );
        return;
      }

      await this.im.sendMessage(
        chatId,
        `Rerun created from: ${parsed.taskId}\nNew task: ${rerun.task.taskId}\nStatus: WAIT_APPROVE_WRITE`
      );
      await this.im.sendMessage(chatId, this.buildApprovalSummary(rerun.task.taskId));
      await this.sendApprovalButtons(chatId, rerun.task.taskId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError ? `${err.message} (code: ${err.code})` : err instanceof Error ? err.message : "Failed to rerun task."
      );
    }
  }

  private async handleCallback(chatId: string, userId: string, data: string): Promise<void> {
    try {
      const { action, taskId } = parseAction(data);
      if (action === "approve") {
        await this.im.sendMessage(chatId, `Task ${taskId} accepted. Status: RUNNING`);
        void this.handleApproveAsync(chatId, userId, taskId);
        return;
      }

      const result = await this.service.applyAction(taskId, action, `tg:${userId}`);

      if (action === "retry") {
        await this.im.sendMessage(chatId, `Task ${taskId} moved to WAIT_APPROVE_WRITE.`);
        await this.im.sendMessage(chatId, this.buildApprovalSummary(taskId));
        await this.sendApprovalButtons(chatId, taskId);
        return;
      }

      if (action === "reject") {
        await this.im.sendMessage(chatId, `Task ${taskId} rejected.`);
        return;
      }
    } catch (err) {
      if (err instanceof TaskServiceError && err.statusCode === 500) {
        const taskId = data.split(":")[1];
        await this.im.sendMessage(chatId, `Task ${taskId} failed. Code: ${err.code}`);
        return;
      }
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError ? `${err.message} (code: ${err.code})` : err instanceof Error ? err.message : "Callback handling failed."
      );
    }
  }

  private async handleApproveAsync(chatId: string, userId: string, taskId: string): Promise<void> {
    try {
      const result = await this.service.applyAction(taskId, "approve", `tg:${userId}`);
      await this.im.sendMessage(
        chatId,
        `Task ${taskId} completed.\nTests: ${result.runResult?.testsResult ?? "unknown"}\nPR: ${result.runResult?.prLink ?? "not created"}`
      );
    } catch (err) {
      if (err instanceof TaskServiceError && err.statusCode === 500) {
        await this.im.sendMessage(chatId, `Task ${taskId} failed. Code: ${err.code}`);
        return;
      }
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError ? `${err.message} (code: ${err.code})` : err instanceof Error ? err.message : "Approval handling failed."
      );
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

  private buildApprovalSummary(taskId: string): string {
    const task = this.service.getTask(taskId);
    const blocked = config.blockedPathPrefixes.join(", ");
    return [
      "Approval summary:",
      `- Task: ${task.taskId}`,
      `- Repo: ${task.repo}`,
      `- Branch: ${task.branch}`,
      `- Intent: ${task.intent}`,
      `- Test command: ${config.defaultTestCommand}`,
      `- Blocked paths: ${blocked || "none"}`,
      `- Max changed files: ${config.maxChangedFiles}`,
      `- Max diff bytes: ${config.maxDiffBytes}`,
      `- Binary patch allowed: ${config.disallowBinaryPatch ? "no" : "yes"}`
    ].join("\n");
  }
}
