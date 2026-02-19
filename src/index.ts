import express from "express";
import { config } from "./config.js";
import { createDb, initDb } from "./db.js";
import { TaskRepository } from "./repositories/taskRepository.js";
import { AuditLogger } from "./services/auditLogger.js";
import { TaskRunner } from "./services/taskRunner.js";
import { CliAgentAdapter } from "./adapters/agent/cliAgentAdapter.js";
import { PrCreator } from "./services/prCreator.js";
import { TaskGateway } from "./services/taskGateway.js";
import { TelegramAdapter } from "./adapters/im/telegramAdapter.js";
import { DockerSandbox } from "./services/dockerSandbox.js";
import { TaskService } from "./services/taskService.js";
import { createTaskRoutes } from "./routes/taskRoutes.js";
import { getHealthDetails } from "./services/health.js";
import { HostAgentExecutor } from "./services/hostAgentExecutor.js";
import { ChatService } from "./services/chatService.js";
import { ChatMemoryRepository } from "./repositories/chatMemoryRepository.js";
import { UserPreferenceRepository } from "./repositories/userPreferenceRepository.js";

async function main(): Promise<void> {
  const db = createDb();
  initDb(db);

  const repo = new TaskRepository(db);
  const userPrefs = new UserPreferenceRepository(db);
  const chatMemory = new ChatMemoryRepository(db);
  const audit = new AuditLogger();
  const agent = new CliAgentAdapter(config.agentCliTemplate);
  const hostExecutor = new HostAgentExecutor(config.repoSnapshotRoot);
  const sandbox = new DockerSandbox({
    image: config.sandboxImage,
    repoRoot: config.repoSnapshotRoot,
    allowedTestCommands: config.allowedTestCommands,
    defaultTestCommand: config.defaultTestCommand
  });
  const prCreator = new PrCreator(config.repoSnapshotRoot);
  const runner = new TaskRunner(agent, hostExecutor, sandbox, prCreator, {
    blockedPathPrefixes: config.blockedPathPrefixes,
    maxChangedFiles: config.maxChangedFiles,
    maxDiffBytes: config.maxDiffBytes,
    disallowBinaryPatch: config.disallowBinaryPatch
  });
  const taskService = new TaskService(repo, audit, runner, config.repoSnapshotRoot, {
    deliveryStrategy: config.deliveryStrategy,
    baseBranch: config.baseBranch,
    agent: config.agentProvider
  });
  const telegram = new TelegramAdapter(config.telegramBotToken, config.telegramWebhookSecret);
  const chatService = new ChatService(
    config.agentProvider,
    ChatService.deriveCliBinary(config.agentCliTemplate, config.chatCliBin),
    config.chatCliTemplate,
    config.repoSnapshotRoot,
    chatMemory,
    config.chatHistoryTurns,
    config.chatMaxPromptChars,
    config.chatTimeoutMs,
    audit
  );
  const gateway = new TaskGateway(telegram, taskService, chatService, userPrefs);

  gateway.bindHandlers();

  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.get("/api/v1/health/details", (_req, res) => res.status(200).json(getHealthDetails()));
  app.use("/api/v1", createTaskRoutes(taskService));
  if (config.telegramMode === "webhook") {
    app.use(telegram.mountWebhook("/webhook/telegram"));
  }

  app.listen(config.port, async () => {
    process.stdout.write(`okaydokki running at :${config.port} (telegram: ${config.telegramMode})\n`);
    if (config.telegramMode === "polling") {
      telegram.startPolling();
      process.stdout.write("telegram polling started\n");
    } else {
      process.stdout.write(`telegram webhook endpoint: ${config.baseUrl}/webhook/telegram\n`);
    }
  });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
