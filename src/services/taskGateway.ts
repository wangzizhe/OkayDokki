import { IMAdapter } from "../adapters/im/imAdapter.js";
import { UserPreferenceRepository } from "../repositories/userPreferenceRepository.js";
import { config } from "../config.js";
import { DeliveryStrategy } from "../types.js";
import { ChatService } from "./chatService.js";
import { TaskAction, TaskService, TaskServiceError } from "./taskService.js";

type TaskParsed = {
  repo: string;
  intent: string;
  deliveryStrategy: DeliveryStrategy;
  baseBranch: string;
  strategySpecified: boolean;
};

function parseTaskLikeCommand(command: "/task" | "/plan", text: string): TaskParsed {
  const trimmed = text.trim();
  const repoMatch = trimmed.match(/repo=([^\s]+)/);
  const strategyMatch = trimmed.match(/strategy=([^\s]+)/);
  const baseMatch = trimmed.match(/base=([^\s]+)/);

  const repo = repoMatch?.[1] ?? config.defaultRepo;
  const strategySpecified = Boolean(strategyMatch?.[1]);
  const strategyRaw = (strategyMatch?.[1] ?? config.deliveryStrategy).toLowerCase();
  if (strategyRaw !== "rolling" && strategyRaw !== "isolated") {
    throw new Error("Invalid strategy. Use strategy=rolling or strategy=isolated.");
  }
  const baseBranch = baseMatch?.[1] ?? config.baseBranch;
  const intent = trimmed
    .replace(new RegExp(`^${command}`), "")
    .replace(/repo=[^\s]+/, "")
    .replace(/strategy=[^\s]+/, "")
    .replace(/base=[^\s]+/, "")
    .trim();
  if (!intent) {
    throw new Error(
      `${command} intent is required. Example: ${command} repo=okd-sandbox strategy=rolling improve tests`
    );
  }

  return {
    repo,
    intent,
    deliveryStrategy: strategyRaw,
    baseBranch,
    strategySpecified
  };
}

function parseTaskCommand(text: string): TaskParsed {
  return parseTaskLikeCommand("/task", text);
}

function parsePlanCommand(text: string): TaskParsed {
  return parseTaskLikeCommand("/plan", text);
}

function parseTaskStatusCommand(text: string): { taskId: string } {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 3 || parts[1] !== "status" || !parts[2]) {
    throw new Error("Usage: /task status <task_id>");
  }
  return { taskId: parts[2] };
}

function parseStrategyCommand(text: string): { mode: "show" | "set" | "clear"; strategy?: DeliveryStrategy } {
  const parts = text.trim().split(/\s+/);
  if (parts.length === 1) {
    return { mode: "show" };
  }
  const arg = parts[1]?.toLowerCase();
  if (arg === "clear") {
    return { mode: "clear" };
  }
  if (arg === "rolling" || arg === "isolated") {
    return { mode: "set", strategy: arg };
  }
  throw new Error("Usage: /strategy [rolling|isolated|clear]");
}

function parseRerunCommand(text: string): { taskId: string } {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Usage: /rerun <task_id>");
  }
  return { taskId: parts[1] };
}

function parseChatCommand(text: string): { repo: string; prompt: string; reset: boolean; cancel: boolean } {
  const trimmed = text.trim();
  if (/^\/chat\s+reset$/i.test(trimmed)) {
    return {
      repo: config.defaultRepo,
      prompt: "",
      reset: true,
      cancel: false
    };
  }
  if (/^\/chat\s+cancel$/i.test(trimmed)) {
    return {
      repo: config.defaultRepo,
      prompt: "",
      reset: false,
      cancel: true
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
  return { repo, prompt, reset: false, cancel: false };
}

type CallbackAction =
  | { kind: "task_action"; action: TaskAction; taskId: string }
  | { kind: "select_strategy"; strategy: DeliveryStrategy; draftId: string }
  | { kind: "details"; taskId: string }
  | { kind: "plan_approve"; planId: string; version: number }
  | { kind: "plan_revise"; planId: string; version: number }
  | { kind: "plan_reject"; planId: string; version: number };

function parsePlanCallbackToken(token: string): { planId: string; version: number } {
  const [planId, rawVersion] = token.split("@");
  const version = Number(rawVersion);
  if (!planId || !Number.isFinite(version) || version < 1) {
    throw new Error("Invalid plan callback token.");
  }
  return { planId, version };
}

function parseAction(raw: string): CallbackAction {
  const [prefix, value] = raw.split(":");
  if (!value) {
    throw new Error("Invalid callback payload.");
  }
  if (prefix === "rty") {
    return { kind: "task_action", action: "retry", taskId: value };
  }
  if (prefix === "apv") {
    return { kind: "task_action", action: "approve", taskId: value };
  }
  if (prefix === "rej") {
    return { kind: "task_action", action: "reject", taskId: value };
  }
  if (prefix === "tsr") {
    return { kind: "select_strategy", strategy: "rolling", draftId: value };
  }
  if (prefix === "tsi") {
    return { kind: "select_strategy", strategy: "isolated", draftId: value };
  }
  if (prefix === "dtl") {
    return { kind: "details", taskId: value };
  }
  if (prefix === "pap") {
    const parsed = parsePlanCallbackToken(value);
    return { kind: "plan_approve", planId: parsed.planId, version: parsed.version };
  }
  if (prefix === "prv") {
    const parsed = parsePlanCallbackToken(value);
    return { kind: "plan_revise", planId: parsed.planId, version: parsed.version };
  }
  if (prefix === "prj") {
    const parsed = parsePlanCallbackToken(value);
    return { kind: "plan_reject", planId: parsed.planId, version: parsed.version };
  }
  throw new Error(`Unsupported callback: ${prefix}`);
}

type PendingTaskDraft = {
  chatId: string;
  userId: string;
  repo: string;
  intent: string;
  baseBranch: string;
};

type PendingPlan = {
  chatId: string;
  userId: string;
  repo: string;
  intent: string;
  strategy: DeliveryStrategy;
  baseBranch: string;
  version: number;
  planText: string;
};

const CALLBACK_DEDUP_TTL_MS = 2 * 60 * 1000;

export class TaskGateway {
  private readonly runningApprovals = new Set<string>();
  private readonly pendingTaskDrafts = new Map<string, PendingTaskDraft>();
  private readonly pendingPlans = new Map<string, PendingPlan>();
  private readonly awaitingPlanFeedback = new Map<string, string>();
  private readonly processedCallbacks = new Map<string, number>();

  constructor(
    private readonly im: IMAdapter,
    private readonly service: TaskService,
    private readonly chat: ChatService,
    private readonly prefs: UserPreferenceRepository
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
    const trimmed = text.trim();
    const sessionKey = this.planFeedbackSessionKey(chatId, `tg:${userId}`);
    if (trimmed.startsWith("/help")) {
      await this.handleHelp(chatId);
      return;
    }
    if (trimmed.startsWith("/last")) {
      await this.handleLast(chatId);
      return;
    }
    if (trimmed.startsWith("/strategy")) {
      await this.handleStrategy(chatId, userId, trimmed);
      return;
    }
    if (trimmed.startsWith("/chat")) {
      await this.handleChat(chatId, userId, text);
      return;
    }
    if (trimmed.startsWith("/task status")) {
      await this.handleTaskStatus(chatId, text);
      return;
    }
    if (trimmed.startsWith("/rerun")) {
      await this.handleRerun(chatId, userId, text);
      return;
    }
    if (trimmed.startsWith("/plan")) {
      await this.handlePlan(chatId, userId, text);
      return;
    }
    if (trimmed.startsWith("/task")) {
      await this.handleTaskCreate(chatId, userId, text);
      return;
    }
    if (trimmed.startsWith("/")) {
      await this.handleHelp(chatId);
      return;
    }

    if (this.awaitingPlanFeedback.has(sessionKey)) {
      await this.handlePlanFeedback(chatId, `tg:${userId}`, trimmed, sessionKey);
      return;
    }

    await this.handleDefaultChat(chatId, userId, text);
  }

  private async handleTaskCreate(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parseTaskCommand(text);
      if (!parsed.strategySpecified) {
        const remembered = this.prefs.getStrategy(chatId, `tg:${userId}`);
        if (remembered) {
          await this.createAndPresentTask(
            chatId,
            `tg:${userId}`,
            parsed.repo,
            parsed.intent,
            remembered,
            parsed.baseBranch
          );
          return;
        }
        const draftId = newDraftId();
        this.pendingTaskDrafts.set(draftId, {
          chatId,
          userId: `tg:${userId}`,
          repo: parsed.repo,
          intent: parsed.intent,
          baseBranch: parsed.baseBranch
        });
        await this.im.sendMessage(
          chatId,
          [
            `Task parsed: ${parsed.intent}`,
            `Repo: ${parsed.repo}`,
            `Base branch: ${parsed.baseBranch}`,
            "Choose delivery strategy:"
          ].join("\n"),
          [[
            { text: "Rolling", callbackData: `tsr:${draftId}` },
            { text: "Isolated", callbackData: `tsi:${draftId}` }
          ]]
        );
        return;
      }
      await this.createAndPresentTask(
        chatId,
        `tg:${userId}`,
        parsed.repo,
        parsed.intent,
        parsed.deliveryStrategy,
        parsed.baseBranch
      );
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to parse task command."
      );
    }
  }

  private async handlePlan(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parsePlanCommand(text);
      const remembered = this.prefs.getStrategy(chatId, `tg:${userId}`);
      const strategy = parsed.strategySpecified ? parsed.deliveryStrategy : (remembered ?? config.deliveryStrategy);
      await this.im.sendMessage(chatId, "Plan accepted. Thinking...");
      void this.handlePlanAsync(chatId, `tg:${userId}`, parsed.repo, parsed.intent, strategy, parsed.baseBranch);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to parse plan command."
      );
    }
  }

  private async handlePlanAsync(
    chatId: string,
    userId: string,
    repo: string,
    intent: string,
    strategy: DeliveryStrategy,
    baseBranch: string
  ): Promise<void> {
    try {
      const planText = await this.chat.ask(
        chatId,
        userId,
        `Create a concise coding plan for this goal. Respond in English only. Use at most 3 bullet points and include key risk checks: ${intent}`,
        repo
      );
      const planId = newDraftId();
      this.pendingPlans.set(planId, { chatId, userId, repo, intent, strategy, baseBranch, version: 1, planText });
      await this.sendPlanDraft(chatId, planId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to generate plan."
      );
    }
  }

  private async createAndPresentTask(
    chatId: string,
    triggerUser: string,
    repo: string,
    intent: string,
    deliveryStrategy: DeliveryStrategy,
    baseBranch: string,
    options?: { showPlanTip?: boolean }
  ): Promise<void> {
    const result = this.service.createTask({
      source: "telegram",
      triggerUser,
      repo,
      intent,
      agent: config.agentProvider,
      deliveryStrategy,
      baseBranch
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
    if (options?.showPlanTip ?? true) {
      await this.im.sendMessage(chatId, "Tip: want a plan first? Use /plan <goal>.");
    }
    await this.sendApprovalPrompt(chatId, result.task.taskId);
  }

  private async handleTaskStatus(chatId: string, text: string): Promise<void> {
    try {
      const parsed = parseTaskStatusCommand(text);
      const task = this.service.getTask(parsed.taskId);
      await this.im.sendMessage(
        chatId,
        [
          `Task: ${task.taskId}`,
          `Status: ${task.status}`,
          `Repo: ${task.repo}`,
          `Branch: ${task.branch}`,
          `Strategy: ${task.deliveryStrategy ?? config.deliveryStrategy}`,
          `Base: ${task.baseBranch ?? config.baseBranch}`,
          `Intent: ${task.intent}`
        ].join("\n")
      );
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to query task status."
      );
    }
  }

  private async handleLast(chatId: string): Promise<void> {
    const latest = this.service.listTasks(1).tasks[0];
    if (!latest) {
      await this.im.sendMessage(chatId, "No tasks found yet.");
      return;
    }
    await this.im.sendMessage(
      chatId,
      [
        `Last task: ${latest.taskId}`,
        `Status: ${latest.status}`,
        `Repo: ${latest.repo}`,
        `Branch: ${latest.branch}`,
        `Intent: ${latest.intent}`
      ].join("\n")
    );
  }

  private async handleHelp(chatId: string): Promise<void> {
    await this.im.sendMessage(
      chatId,
      [
        "How to use OkayDokki:",
        "- Send a normal message: chat with the agent (no write).",
        "- /plan <goal>: generate a plan, then approve to run.",
        "- /task <goal>: run directly with approval."
      ].join("\n")
    );
  }

  private async handleStrategy(chatId: string, userId: string, text: string): Promise<void> {
    try {
      const parsed = parseStrategyCommand(text);
      const keyUser = `tg:${userId}`;
      if (parsed.mode === "show") {
        const strategy = this.prefs.getStrategy(chatId, keyUser);
        await this.im.sendMessage(
          chatId,
          strategy
            ? `Current strategy preference: ${strategy}`
            : `No strategy preference set. Default is ${config.deliveryStrategy}.`
        );
        return;
      }
      if (parsed.mode === "clear") {
        this.prefs.setStrategy(chatId, keyUser, config.deliveryStrategy);
        await this.im.sendMessage(
          chatId,
          `Strategy preference cleared. Default is now ${config.deliveryStrategy}.`
        );
        return;
      }
      this.prefs.setStrategy(chatId, keyUser, parsed.strategy as DeliveryStrategy);
      await this.im.sendMessage(chatId, `Strategy preference set to ${parsed.strategy}.`);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to set strategy."
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
      if (parsed.cancel) {
        const canceled = this.chat.cancel(chatId, `tg:${userId}`);
        await this.im.sendMessage(
          chatId,
          canceled ? "Active chat request canceled." : "No active chat request to cancel."
        );
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

  private async handleDefaultChat(chatId: string, userId: string, text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }
    await this.im.sendMessage(chatId, "Chat accepted. Thinking...");
    void this.handleChatAsync(chatId, userId, config.defaultRepo, prompt);
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
      await this.sendApprovalPrompt(chatId, rerun.task.taskId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError
          ? `${err.message} (code: ${err.code})`
          : err instanceof Error
            ? err.message
            : "Failed to rerun task."
      );
    }
  }

  private async handleCallback(chatId: string, userId: string, data: string): Promise<void> {
    try {
      const parsed = parseAction(data);
      if (parsed.kind !== "details") {
        const callbackKey = `${chatId}:${userId}:${data}`;
        if (this.isProcessedCallback(callbackKey)) {
          await this.im.sendMessage(chatId, "Action already processed.");
          return;
        }
        this.markProcessedCallback(callbackKey);
      }
      if (parsed.kind === "select_strategy") {
        const draft = this.pendingTaskDrafts.get(parsed.draftId);
        if (!draft) {
          await this.im.sendMessage(chatId, "Strategy selection expired. Please send /task again.");
          return;
        }
        if (draft.chatId !== chatId || draft.userId !== `tg:${userId}`) {
          await this.im.sendMessage(chatId, "This strategy selection is not owned by your session.");
          return;
        }
        this.pendingTaskDrafts.delete(parsed.draftId);
        this.prefs.setStrategy(chatId, draft.userId, parsed.strategy);
        await this.createAndPresentTask(
          chatId,
          draft.userId,
          draft.repo,
          draft.intent,
          parsed.strategy,
          draft.baseBranch
        );
        return;
      }

      if (parsed.kind === "plan_approve") {
        const plan = this.pendingPlans.get(parsed.planId);
        if (!plan) {
          await this.im.sendMessage(chatId, "Plan approval expired. Please run /plan again.");
          return;
        }
        if (plan.version !== parsed.version) {
          await this.im.sendMessage(chatId, "Plan is outdated. Please review the latest version.");
          return;
        }
        this.pendingPlans.delete(parsed.planId);
        this.awaitingPlanFeedback.delete(this.planFeedbackSessionKey(plan.chatId, plan.userId));
        await this.im.sendMessage(chatId, `Plan approved. Creating task in WAIT_APPROVE_WRITE...`);
        await this.createAndPresentTask(
          chatId,
          plan.userId,
          plan.repo,
          plan.intent,
          plan.strategy,
          plan.baseBranch,
          { showPlanTip: false }
        );
        return;
      }
      if (parsed.kind === "plan_revise") {
        const plan = this.pendingPlans.get(parsed.planId);
        if (!plan) {
          await this.im.sendMessage(chatId, "Plan revision expired. Please run /plan again.");
          return;
        }
        if (plan.version !== parsed.version) {
          await this.im.sendMessage(chatId, "Plan is outdated. Please review the latest version.");
          return;
        }
        if (plan.chatId !== chatId || plan.userId !== `tg:${userId}`) {
          await this.im.sendMessage(chatId, "This plan is not owned by your session.");
          return;
        }
        this.awaitingPlanFeedback.set(this.planFeedbackSessionKey(chatId, `tg:${userId}`), parsed.planId);
        await this.im.sendMessage(
          chatId,
          `Plan v${plan.version} selected for revision. Reply with your feedback in one message.`
        );
        return;
      }
      if (parsed.kind === "plan_reject") {
        const plan = this.pendingPlans.get(parsed.planId);
        if (!plan) {
          await this.im.sendMessage(chatId, "Plan already closed.");
          return;
        }
        if (plan.version !== parsed.version) {
          await this.im.sendMessage(chatId, "Plan is outdated. Please review the latest version.");
          return;
        }
        this.pendingPlans.delete(parsed.planId);
        this.awaitingPlanFeedback.delete(this.planFeedbackSessionKey(plan.chatId, plan.userId));
        await this.im.sendMessage(chatId, "Plan rejected.");
        return;
      }

      if (parsed.kind === "details") {
        await this.im.sendMessage(chatId, this.buildApprovalDetails(parsed.taskId));
        return;
      }

      const { action, taskId } = parsed;
      if (action === "approve") {
        if (this.runningApprovals.has(taskId)) {
          await this.im.sendMessage(chatId, `Task ${taskId} is already running.`);
          return;
        }
        this.runningApprovals.add(taskId);
        await this.im.sendMessage(chatId, `Task ${taskId} accepted. Status: RUNNING`);
        void this.handleApproveAsync(chatId, userId, taskId);
        return;
      }

      await this.service.applyAction(taskId, action, `tg:${userId}`);

      if (action === "retry") {
        await this.im.sendMessage(chatId, `Task ${taskId} moved to WAIT_APPROVE_WRITE.`);
        await this.sendApprovalPrompt(chatId, taskId);
        return;
      }

      if (action === "reject") {
        await this.im.sendMessage(chatId, `Task ${taskId} rejected.`);
        return;
      }
    } catch (err) {
      if (err instanceof TaskServiceError && err.statusCode === 500) {
        const taskId = data.split(":")[1] ?? "";
        await this.im.sendMessage(
          chatId,
          this.buildFailureMessage(taskId, err)
        );
        return;
      }
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError
          ? `${err.message} (code: ${err.code})`
          : err instanceof Error
            ? err.message
            : "Callback handling failed."
      );
    }
  }

  private async handleApproveAsync(chatId: string, userId: string, taskId: string): Promise<void> {
    try {
      const result = await this.service.applyAction(taskId, "approve", `tg:${userId}`);
      await this.im.sendMessage(
        chatId,
        this.buildCompletionMessage(taskId, result.task.intent, result.runResult)
      );
    } catch (err) {
      if (err instanceof TaskServiceError && err.statusCode === 500) {
        await this.im.sendMessage(
          chatId,
          this.buildFailureMessage(taskId, err)
        );
        return;
      }
      await this.im.sendMessage(
        chatId,
        err instanceof TaskServiceError
          ? `${err.message} (code: ${err.code})`
          : err instanceof Error
            ? err.message
            : "Approval handling failed."
      );
    } finally {
      this.runningApprovals.delete(taskId);
    }
  }

  private async sendApprovalPrompt(chatId: string, taskId: string): Promise<void> {
    await this.im.sendMessage(chatId, this.buildApprovalSummary(taskId), [
      [
        { text: "Details", callbackData: `dtl:${taskId}` },
        { text: "Approve", callbackData: `apv:${taskId}` },
        { text: "Reject", callbackData: `rej:${taskId}` }
      ]
    ]);
  }

  private async sendPlanDraft(chatId: string, planId: string): Promise<void> {
    const plan = this.pendingPlans.get(planId);
    if (!plan) {
      return;
    }
    await this.im.sendMessage(
      chatId,
      [`Plan v${plan.version} for: ${plan.intent}`, "", plan.planText].join("\n"),
      [[
        { text: "Approve Plan", callbackData: `pap:${planId}@${plan.version}` },
        { text: "Revise Plan", callbackData: `prv:${planId}@${plan.version}` },
        { text: "Reject Plan", callbackData: `prj:${planId}@${plan.version}` }
      ]]
    );
  }

  private async handlePlanFeedback(
    chatId: string,
    userId: string,
    feedback: string,
    sessionKey: string
  ): Promise<void> {
    const planId = this.awaitingPlanFeedback.get(sessionKey);
    if (!planId) {
      return;
    }
    const plan = this.pendingPlans.get(planId);
    if (!plan) {
      this.awaitingPlanFeedback.delete(sessionKey);
      await this.im.sendMessage(chatId, "Plan revision expired. Please run /plan again.");
      return;
    }
    if (plan.chatId !== chatId || plan.userId !== userId) {
      await this.im.sendMessage(chatId, "This plan is not owned by your session.");
      return;
    }

    this.awaitingPlanFeedback.delete(sessionKey);
    await this.im.sendMessage(chatId, `Revision accepted for plan v${plan.version}. Thinking...`);
    try {
      const revisedPlan = await this.chat.ask(
        chatId,
        userId,
        [
          "Revise the coding plan based on user feedback.",
          "Respond in English only.",
          `Goal: ${plan.intent}`,
          "Current plan:",
          plan.planText,
          "User feedback:",
          feedback,
          "Keep it concise, use at most 3 bullet points, and include risk checks."
        ].join("\n"),
        plan.repo
      );
      plan.planText = revisedPlan;
      plan.version += 1;
      this.pendingPlans.set(planId, plan);
      await this.sendPlanDraft(chatId, planId);
    } catch (err) {
      await this.im.sendMessage(
        chatId,
        err instanceof Error ? err.message : "Failed to revise plan."
      );
    }
  }

  private buildApprovalSummary(taskId: string): string {
    const task = this.service.getTask(taskId);
    return [
      "Approval summary:",
      `- Task: ${task.taskId}`,
      `- Repo/Branch: ${task.repo} / ${task.branch}`,
      `- Intent: ${truncate(task.intent, 100)}`,
      `- Strategy/Base/Test: ${task.deliveryStrategy ?? config.deliveryStrategy} / ${task.baseBranch ?? config.baseBranch} / ${config.defaultTestCommand}`,
      "",
      "Tap Details to view full policy limits."
    ].join("\n");
  }

  private buildApprovalDetails(taskId: string): string {
    const task = this.service.getTask(taskId);
    const blocked = config.blockedPathPrefixes.join(", ");
    return [
      "Approval details:",
      `- Task: ${task.taskId}`,
      `- Repo: ${task.repo}`,
      `- Branch: ${task.branch}`,
      `- Intent: ${task.intent}`,
      `- Delivery strategy: ${task.deliveryStrategy ?? config.deliveryStrategy}`,
      `- Base branch: ${task.baseBranch ?? config.baseBranch}`,
      `- Test command: ${config.defaultTestCommand}`,
      `- Blocked paths: ${blocked || "none"}`,
      `- Max changed files: ${config.maxChangedFiles}`,
      `- Max diff bytes: ${config.maxDiffBytes}`,
      `- Binary patch allowed: ${config.disallowBinaryPatch ? "no" : "yes"}`
    ].join("\n");
  }

  private failureHint(code: string): string {
    const hints: Record<string, string> = {
      SNAPSHOT_MISSING: "Prepare repo snapshot under REPO_SNAPSHOT_ROOT and tap Retry.",
      AGENT_FAILED: "Check AGENT_CLI_TEMPLATE and provider login status.",
      SANDBOX_FAILED: "Check Docker daemon/image and allowed test command.",
      POLICY_VIOLATION: "Reduce diff scope or adjust policy limits/blocked paths.",
      TEST_FAILED: "Inspect test logs and rerun after fixing failures.",
      PR_CREATE_FAILED: "Verify git remote/push permissions and gh auth."
    };
    return hints[code] ?? "Check audit log for details.";
  }

  private buildFailureMessage(taskId: string, err: TaskServiceError): string {
    const lines = [`Task ${taskId} failed.`];
    const detail = this.failureDetail(err);
    lines.push("Execution summary:");
    lines.push(`- Failed at: ${this.failureStage(err.code)}`);
    lines.push(`- Code: ${err.code}`);
    lines.push(`- Reason: ${detail ?? "See audit log for details."}`);
    lines.push(`- Suggested next step: ${this.failureHint(err.code)}`);
    return lines.join("\n");
  }

  private buildCompletionMessage(
    taskId: string,
    intent: string,
    runResult:
      | {
          testsResult?: string;
          prLink?: string | null;
          hasDiff?: boolean;
          changedFiles?: string[];
          insertions?: number;
          deletions?: number;
        }
      | undefined
  ): string {
    const tests = runResult?.testsResult ?? "unknown";
    const pr = runResult?.prLink ?? "not created";
    const hasDiff = Boolean(runResult?.hasDiff);
    const files = runResult?.changedFiles ?? [];
    const whatChanged = this.buildWhatChangedSummary(hasDiff, files, intent);
    return [
      `Task ${taskId} completed.`,
      "Execution summary:",
      `- ${whatChanged}`,
      `- Files changed: ${this.buildFilesSummary(hasDiff, files)}`,
      `- Tests: ${tests}`,
      `- PR: ${pr}`
    ].join("\n");
  }

  private buildWhatChangedSummary(hasDiff: boolean, changedFiles: string[], intent: string): string {
    if (!hasDiff) {
      return "No file changes were required for this run.";
    }
    if (changedFiles.length === 0) {
      return "Applied code changes to complete the requested task.";
    }
    const normalized = changedFiles.map((file) => file.toLowerCase());
    const docFiles = normalized.filter((f) => f.endsWith(".md") || f.includes("readme"));
    const testFiles = normalized.filter((f) => f.includes("/test") || f.includes("tests/") || f.endsWith(".test.ts") || f.endsWith(".test.js"));
    const codeFiles = normalized.filter((f) => !docFiles.includes(f) && !testFiles.includes(f));

    const actions: string[] = [];
    if (docFiles.length > 0) {
      actions.push("documentation");
    }
    if (testFiles.length > 0) {
      actions.push("test coverage");
    }
    if (codeFiles.length > 0) {
      actions.push("application code");
    }

    if (actions.length === 0) {
      return "Applied file updates and completed the requested task.";
    }
    if (actions.length === 1) {
      return `Updated ${actions[0]}.`;
    }
    if (actions.length === 2) {
      return `Updated ${actions[0]} and ${actions[1]}.`;
    }
    return `Updated ${actions[0]}, ${actions[1]}, and ${actions[2]}.`;
  }

  private buildFilesSummary(hasDiff: boolean, changedFiles: string[]): string {
    if (!hasDiff) {
      return "None.";
    }
    if (changedFiles.length === 0) {
      return "Changes detected (file list unavailable).";
    }
    const top = changedFiles.slice(0, 5);
    return `${top.join(", ")}${changedFiles.length > 5 ? ", ..." : ""}.`;
  }

  private failureDetail(err: TaskServiceError): string | null {
    if (err.code === "POLICY_VIOLATION") {
      const raw = err.message.replace(/^Diff policy violation:\s*/i, "").trim();
      if (!raw) {
        return null;
      }
      const short = raw
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join("; ");
      return short || raw;
    }
    if (err.code === "TEST_FAILED") {
      return "test command exited non-zero";
    }
    if (err.code === "AGENT_FAILED") {
      return "agent command failed to produce a valid result";
    }
    if (err.code === "SANDBOX_FAILED") {
      return "sandbox validation failed (docker/run/test)";
    }
    if (err.code === "PR_CREATE_FAILED") {
      return "draft PR creation step failed";
    }
    return null;
  }

  private failureStage(code: string): string {
    const stages: Record<string, string> = {
      SNAPSHOT_MISSING: "repo snapshot preparation",
      AGENT_FAILED: "agent execution",
      SANDBOX_FAILED: "sandbox validation",
      POLICY_VIOLATION: "diff policy checks",
      TEST_FAILED: "test execution",
      PR_CREATE_FAILED: "draft PR creation",
      RUN_FAILED: "task execution"
    };
    return stages[code] ?? "task execution";
  }

  private planFeedbackSessionKey(chatId: string, userId: string): string {
    return `${chatId}:${userId}`;
  }

  private isProcessedCallback(key: string): boolean {
    this.pruneProcessedCallbacks();
    const ts = this.processedCallbacks.get(key);
    if (!ts) {
      return false;
    }
    return Date.now() - ts <= CALLBACK_DEDUP_TTL_MS;
  }

  private markProcessedCallback(key: string): void {
    this.pruneProcessedCallbacks();
    this.processedCallbacks.set(key, Date.now());
  }

  private pruneProcessedCallbacks(): void {
    const now = Date.now();
    for (const [key, ts] of this.processedCallbacks.entries()) {
      if (now - ts > CALLBACK_DEDUP_TTL_MS) {
        this.processedCallbacks.delete(key);
      }
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
}

function newDraftId(): string {
  return Math.random().toString(36).slice(2, 10);
}
