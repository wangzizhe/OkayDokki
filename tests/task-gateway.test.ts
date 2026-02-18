import test from "node:test";
import assert from "node:assert/strict";
import { TaskGateway } from "../src/services/taskGateway.js";
import { InlineButton } from "../src/adapters/im/imAdapter.js";
import { config } from "../src/config.js";

type SentMessage = {
  chatId: string;
  content: string;
  buttons?: InlineButton[][];
};

class FakeIMAdapter {
  public readonly sent: SentMessage[] = [];
  private taskHandler: ((chatId: string, userId: string, text: string) => Promise<void>) | null = null;
  private callbackHandler: ((chatId: string, userId: string, data: string) => Promise<void>) | null = null;

  onTaskCommand(handler: (chatId: string, userId: string, text: string) => Promise<void>): void {
    this.taskHandler = handler;
  }

  onCallback(handler: (chatId: string, userId: string, data: string) => Promise<void>): void {
    this.callbackHandler = handler;
  }

  async sendMessage(chatId: string, content: string, buttons?: InlineButton[][]): Promise<void> {
    this.sent.push({ chatId, content, buttons });
  }

  mountWebhook(): never {
    throw new Error("not used in tests");
  }

  async dispatchTask(chatId: string, userId: string, text: string): Promise<void> {
    assert.ok(this.taskHandler, "task handler not bound");
    await this.taskHandler(chatId, userId, text);
  }

  async dispatchCallback(chatId: string, userId: string, data: string): Promise<void> {
    assert.ok(this.callbackHandler, "callback handler not bound");
    await this.callbackHandler(chatId, userId, data);
  }
}

class FakeTaskService {
  private seq = 0;
  public lastTaskId = "";

  createTask(input: { repo: string; intent: string; deliveryStrategy?: "rolling" | "isolated"; baseBranch?: string }) {
    this.seq += 1;
    const taskId = `task-${this.seq}`;
    this.lastTaskId = taskId;
    return {
      task: {
        taskId,
        source: { im: "telegram" as const },
        triggerUser: "tg:u1",
        repo: input.repo,
        branch: `agent/${this.seq}`,
        intent: input.intent,
        agent: "codex",
        status: "WAIT_APPROVE_WRITE" as const,
        createdAt: new Date().toISOString(),
        approvedBy: null,
        deliveryStrategy: input.deliveryStrategy ?? "rolling",
        baseBranch: input.baseBranch ?? "main"
      },
      needsClarify: false
    };
  }

  getTask(taskId: string) {
    return {
      taskId,
      repo: "okd-sandbox",
      branch: "agent/test",
      intent: "test intent",
      status: "WAIT_APPROVE_WRITE",
      deliveryStrategy: "rolling",
      baseBranch: "main"
    };
  }

  listTasks() {
    return { tasks: [] };
  }

  rerunTask() {
    throw new Error("not used");
  }

  async applyAction(taskId: string) {
    return {
      task: {
        taskId,
        source: { im: "telegram" as const },
        triggerUser: "tg:u1",
        repo: "okd-sandbox",
        branch: "agent/test",
        intent: "test intent",
        agent: "codex",
        status: "COMPLETED" as const,
        createdAt: new Date().toISOString(),
        approvedBy: "tg:u1",
        deliveryStrategy: "rolling" as const,
        baseBranch: "main"
      },
      runResult: {
        testsResult: "PASS",
        testLog: "",
        diffHash: "h",
        hasDiff: true,
        agentLogs: [],
        agentMeta: {},
        prLink: null
      }
    };
  }
}

class FakeChatService {
  public readonly asks: Array<{ prompt: string; repo: string }> = [];

  async ask(_chatId: string, _userId: string, prompt: string, repo: string): Promise<string> {
    this.asks.push({ prompt, repo });
    if (prompt.startsWith("Create a concise coding plan")) {
      return "1. Inspect code\n2. Implement\n3. Validate";
    }
    if (prompt.startsWith("Revise the coding plan based on user feedback.")) {
      return "1. Narrow scope\n2. Add rollback check\n3. Validate";
    }
    return "chat response";
  }

  reset(): void {}
  cancel(): boolean {
    return false;
  }
}

class FakePrefs {
  getStrategy(): "rolling" {
    return "rolling";
  }
  setStrategy(): void {}
}

async function flushAsyncTurns(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function findButtonData(message: SentMessage, label: string): string {
  const rows = message.buttons ?? [];
  for (const row of rows) {
    for (const btn of row) {
      if (btn.text === label) {
        return btn.callbackData;
      }
    }
  }
  throw new Error(`button not found: ${label}`);
}

test("plan supports revise flow and invalidates old version callbacks", async () => {
  const im = new FakeIMAdapter();
  const service = new FakeTaskService();
  const chat = new FakeChatService();
  const prefs = new FakePrefs();
  const gateway = new TaskGateway(im as never, service as never, chat as never, prefs as never);
  gateway.bindHandlers();

  await im.dispatchTask("c1", "u1", "/plan repo=okd-sandbox improve login flow");
  await flushAsyncTurns();

  const v1 = im.sent.find((m) => m.content.startsWith("Plan v1 for:"));
  assert.ok(v1, "plan v1 message should be sent");
  const reviseV1 = findButtonData(v1, "Revise Plan");
  const approveV1 = findButtonData(v1, "Approve Plan");

  await im.dispatchCallback("c1", "u1", reviseV1);
  assert.equal(
    im.sent.at(-1)?.content,
    "Plan v1 selected for revision. Reply with your feedback in one message."
  );

  await im.dispatchTask("c1", "u1", "Please add rollback strategy and shrink step 2.");
  await flushAsyncTurns();

  const v2 = im.sent.find((m) => m.content.startsWith("Plan v2 for:"));
  assert.ok(v2, "plan v2 message should be sent");
  const approveV2 = findButtonData(v2, "Approve Plan");

  await im.dispatchCallback("c1", "u1", approveV1);
  assert.equal(im.sent.at(-1)?.content, "Plan is outdated. Please review the latest version.");

  await im.dispatchCallback("c1", "u1", approveV2);
  await flushAsyncTurns();
  assert.ok(
    im.sent.some((m) => m.content === "Plan approved. Creating task in WAIT_APPROVE_WRITE..."),
    "approved v2 should create task and wait for write approval"
  );
  assert.ok(
    im.sent.some((m) => m.content.startsWith("Task parsed: ") && m.content.includes("WAIT_APPROVE_WRITE")),
    "approved v2 should show standard approval summary entry point"
  );
});

test("normal text message routes to default chat flow", async () => {
  const im = new FakeIMAdapter();
  const service = new FakeTaskService();
  const chat = new FakeChatService();
  const prefs = new FakePrefs();
  const gateway = new TaskGateway(im as never, service as never, chat as never, prefs as never);
  gateway.bindHandlers();

  await im.dispatchTask("c2", "u2", "What should we improve next?");
  await flushAsyncTurns();

  assert.equal(im.sent[0]?.content, "Chat accepted. Thinking...");
  assert.equal(im.sent[1]?.content, "chat response");
  assert.equal(chat.asks[0]?.repo, config.defaultRepo);
});
