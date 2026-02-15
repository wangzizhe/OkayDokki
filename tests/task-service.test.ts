import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { TaskRepository } from "../src/repositories/taskRepository.js";
import { AuditLogger } from "../src/services/auditLogger.js";
import { TaskRunner } from "../src/services/taskRunner.js";
import { TaskService } from "../src/services/taskService.js";
import { TaskRunResult } from "../src/types.js";

type TestContext = {
  tempDir: string;
  repoRoot: string;
  auditPath: string;
  service: TaskService;
};

function setup(runnerResult: TaskRunResult): TestContext {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "okd-test-"));
  const repoRoot = path.join(tempDir, "repos");
  fs.mkdirSync(repoRoot, { recursive: true });
  const auditPath = path.join(tempDir, "audit.jsonl");

  const db = new Database(":memory:");
  const schema = fs.readFileSync(path.resolve(process.cwd(), "sql/schema.sql"), "utf8");
  db.exec(schema);

  const repo = new TaskRepository(db as never);
  const audit = new AuditLogger(auditPath);
  const runner = {
    run: async () => runnerResult
  } as unknown as TaskRunner;
  const service = new TaskService(repo, audit, runner, repoRoot);

  return { tempDir, repoRoot, auditPath, service };
}

function cleanup(tempDir: string): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function defaultRunResult(): TaskRunResult {
  return {
    testsResult: "PASS",
    diffHash: "diff-sha",
    agentLogs: ["ok"],
    agentMeta: { engine: "codex", protocol: "v1" },
    prLink: "https://github.com/org/name/pull/1"
  };
}

test("createTask enters WAIT_CLARIFY when snapshot is missing", () => {
  const ctx = setup(defaultRunResult());
  try {
    const created = ctx.service.createTask({
      source: "api",
      triggerUser: "tg:1",
      repo: "org/name",
      intent: "fix login 500"
    });

    assert.equal(created.needsClarify, true);
    assert.equal(created.task.status, "WAIT_CLARIFY");
    assert.ok(created.expectedPath?.endsWith(path.join("repos", "org", "name")));
  } finally {
    cleanup(ctx.tempDir);
  }
});

test("retry moves WAIT_CLARIFY to WAIT_APPROVE_WRITE after snapshot is prepared", async () => {
  const ctx = setup(defaultRunResult());
  try {
    const created = ctx.service.createTask({
      source: "api",
      triggerUser: "tg:1",
      repo: "org/name",
      intent: "fix login 500"
    });
    assert.equal(created.task.status, "WAIT_CLARIFY");

    fs.mkdirSync(path.join(ctx.repoRoot, "org", "name"), { recursive: true });
    const retried = await ctx.service.applyAction(created.task.taskId, "retry", "tg:1");

    assert.equal(retried.task.status, "WAIT_APPROVE_WRITE");
  } finally {
    cleanup(ctx.tempDir);
  }
});

test("approve runs task and completes with audit trail", async () => {
  const ctx = setup(defaultRunResult());
  try {
    fs.mkdirSync(path.join(ctx.repoRoot, "org", "name"), { recursive: true });
    const created = ctx.service.createTask({
      source: "api",
      triggerUser: "tg:1",
      repo: "org/name",
      intent: "fix login 500"
    });
    assert.equal(created.task.status, "WAIT_APPROVE_WRITE");

    const approved = await ctx.service.applyAction(created.task.taskId, "approve", "tg:1");
    assert.equal(approved.task.status, "COMPLETED");
    assert.equal(approved.runResult?.testsResult, "PASS");
    assert.equal(approved.runResult?.prLink, "https://github.com/org/name/pull/1");

    const lines = fs
      .readFileSync(ctx.auditPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { eventType: string; auditVersion: string });

    const eventTypes = lines.map((line) => line.eventType);
    assert.deepEqual(eventTypes, ["REQUEST", "APPROVE", "RUN", "PR_CREATED"]);
    assert.ok(lines.every((line) => line.auditVersion === "1.0"));
  } finally {
    cleanup(ctx.tempDir);
  }
});

