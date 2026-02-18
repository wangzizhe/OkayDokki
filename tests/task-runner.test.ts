import test from "node:test";
import assert from "node:assert/strict";
import { TaskRunner, TaskRunnerError } from "../src/services/taskRunner.js";
import { TaskSpec } from "../src/types.js";

const task: TaskSpec = {
  taskId: "t1",
  source: { im: "api" },
  triggerUser: "tg:1",
  repo: "org/name",
  branch: "agent/t1",
  intent: "test",
  agent: "codex",
  status: "RUNNING",
  createdAt: new Date().toISOString(),
  approvedBy: "tg:1"
};

function createRunner(params: {
  diff: string;
  testExitCode?: number;
  prLink?: string | null;
}): TaskRunner {
  const adapter = { buildCommand: () => "echo run" };
  const hostExecutor = {
    run: async () => ({
      diff: params.diff,
      agentLogs: [],
      agentMeta: {},
      candidatePath: "/tmp/candidate",
      cleanup: () => {}
    })
  };
  const sandbox = {
    runValidation: async () => ({
      testExitCode: params.testExitCode ?? 0,
      testLog: "ok"
    })
  };
  const prCreator = {
    createDraftPr: async () => params.prLink ?? "https://example.com/pr/1"
  };
  return new TaskRunner(
    adapter as never,
    hostExecutor as never,
    sandbox as never,
    prCreator as never,
    {
      blockedPathPrefixes: [".github/workflows/", "secrets/"],
      maxChangedFiles: 10,
      maxDiffBytes: 20000,
      disallowBinaryPatch: true
    }
  );
}

test("runner maps agent execution failures to AGENT_FAILED", async () => {
  const adapter = { buildCommand: () => "echo run" };
  const hostExecutor = {
    run: async () => {
      throw new Error("not logged in");
    }
  };
  const sandbox = {
    runValidation: async () => ({
      testExitCode: 0,
      testLog: "ok"
    })
  };
  const prCreator = {
    createDraftPr: async () => "https://example.com/pr/1"
  };
  const runner = new TaskRunner(
    adapter as never,
    hostExecutor as never,
    sandbox as never,
    prCreator as never,
    {
      blockedPathPrefixes: [".github/workflows/", "secrets/"],
      maxChangedFiles: 10,
      maxDiffBytes: 20000,
      disallowBinaryPatch: true
    }
  );
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "AGENT_FAILED");
      return true;
    }
  );
});

test("runner maps sandbox failures to SANDBOX_FAILED", async () => {
  const adapter = { buildCommand: () => "echo run" };
  const hostExecutor = {
    run: async () => ({
      diff: "",
      agentLogs: [],
      agentMeta: {},
      candidatePath: "/tmp/candidate",
      cleanup: () => {}
    })
  };
  const sandbox = {
    runValidation: async () => {
      throw new Error("docker down");
    }
  };
  const prCreator = {
    createDraftPr: async () => "https://example.com/pr/1"
  };
  const runner = new TaskRunner(
    adapter as never,
    hostExecutor as never,
    sandbox as never,
    prCreator as never,
    {
      blockedPathPrefixes: [".github/workflows/", "secrets/"],
      maxChangedFiles: 10,
      maxDiffBytes: 20000,
      disallowBinaryPatch: true
    }
  );
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "SANDBOX_FAILED");
      return true;
    }
  );
});

test("runner blocks diff that modifies blocked path", async () => {
  const runner = createRunner({
    diff: "diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1 +1 @@\n-test\n+prod\n"
  });
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "POLICY_VIOLATION");
      assert.match(err.message, /blocked path/);
      return true;
    }
  );
});

test("runner blocks binary patches", async () => {
  const runner = createRunner({
    diff: "GIT binary patch\nliteral 0\n"
  });
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "POLICY_VIOLATION");
      assert.match(err.message, /binary patch/);
      return true;
    }
  );
});

test("runner blocks excessive changed files", async () => {
  const many = Array.from({ length: 11 })
    .map(
      (_, i) =>
        `diff --git a/src/f${i}.ts b/src/f${i}.ts\n--- a/src/f${i}.ts\n+++ b/src/f${i}.ts\n@@ -1 +1 @@\n-a\n+b\n`
    )
    .join("\n");
  const runner = createRunner({ diff: many });
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "POLICY_VIOLATION");
      assert.match(err.message, /changed file count/);
      return true;
    }
  );
});

test("runner allows compliant diff and creates PR", async () => {
  const runner = createRunner({
    diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
    prLink: "https://example.com/pr/42"
  });
  const result = await runner.run(task);
  assert.equal(result.hasDiff, true);
  assert.equal(result.prLink, "https://example.com/pr/42");
});

test("runner maps pr creator failures to PR_CREATE_FAILED", async () => {
  const adapter = { buildCommand: () => "echo run" };
  const hostExecutor = {
    run: async () => ({
      diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
      agentLogs: [],
      agentMeta: {},
      candidatePath: "/tmp/candidate",
      cleanup: () => {}
    })
  };
  const sandbox = {
    runValidation: async () => ({
      testExitCode: 0,
      testLog: "ok"
    })
  };
  const prCreator = {
    createDraftPr: async () => {
      throw new Error("gh missing");
    }
  };
  const runner = new TaskRunner(
    adapter as never,
    hostExecutor as never,
    sandbox as never,
    prCreator as never,
    {
      blockedPathPrefixes: [],
      maxChangedFiles: 10,
      maxDiffBytes: 20000,
      disallowBinaryPatch: true
    }
  );
  await assert.rejects(
    () => runner.run(task),
    (err: unknown) => {
      assert.ok(err instanceof TaskRunnerError);
      assert.equal(err.code, "PR_CREATE_FAILED");
      return true;
    }
  );
});
