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

async function main(): Promise<void> {
  const db = createDb();
  initDb(db);

  const repo = new TaskRepository(db);
  const audit = new AuditLogger();
  const agent = new CliAgentAdapter(config.agentCliTemplate);
  const sandbox = new DockerSandbox({
    image: config.sandboxImage,
    repoRoot: config.repoSnapshotRoot,
    allowedTestCommands: config.allowedTestCommands,
    defaultTestCommand: config.defaultTestCommand
  });
  const prCreator = new PrCreator();
  const runner = new TaskRunner(agent, sandbox, prCreator);
  const taskService = new TaskService(repo, audit, runner, config.repoSnapshotRoot);
  const telegram = new TelegramAdapter(config.telegramBotToken, config.telegramWebhookSecret);
  const gateway = new TaskGateway(telegram, taskService);

  gateway.bindHandlers();

  const app = express();
  app.use(express.json());
  app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
  app.use("/api/v1", createTaskRoutes(taskService));
  app.use(telegram.mountWebhook("/webhook/telegram"));

  app.listen(config.port, () => {
    process.stdout.write(`okaydokki running at :${config.port}\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
