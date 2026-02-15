import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createTaskRoutes } from "../src/routes/taskRoutes.js";
import { TaskServiceError } from "../src/services/taskService.js";

type MockService = {
  createTask: (input: {
    source: "telegram" | "api";
    triggerUser: string;
    repo: string;
    intent: string;
    agent?: string;
  }) => {
    task: { taskId: string; status: string };
    needsClarify: boolean;
    expectedPath?: string;
  };
  getTask: (taskId: string) => { taskId: string; status: string };
  applyAction: (
    taskId: string,
    action: "retry" | "approve" | "reject",
    actor: string
  ) => Promise<{
    task: { taskId: string; status: string };
    runResult?: { testsResult: string; diffHash: string; agentLogs: string[]; prLink: string | null };
  }>;
};

type ResponseCapture = {
  statusCode: number;
  body: unknown;
};

async function invokeRoute(params: {
  router: express.Router;
  method: "post" | "get";
  path: string;
  reqBody?: unknown;
  reqParams?: Record<string, string>;
}): Promise<ResponseCapture> {
  const layer = params.router.stack.find((l) => {
    const route = (l as { route?: { path?: string; methods?: Record<string, boolean> } }).route;
    return route?.path === params.path && route.methods?.[params.method] === true;
  }) as
    | {
        route: {
          stack: Array<{ handle: (req: express.Request, res: express.Response) => unknown }>;
        };
      }
    | undefined;

  if (!layer) {
    throw new Error(`Route not found: ${params.method.toUpperCase()} ${params.path}`);
  }

  let statusCode = 200;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    }
  } as unknown as express.Response;

  const req = {
    body: params.reqBody ?? {},
    params: params.reqParams ?? {}
  } as express.Request;

  await layer.route.stack[0].handle(req, res);
  return { statusCode, body };
}

test("POST /tasks returns 400 for missing fields", async () => {
  const mock: MockService = {
    createTask: () => {
      throw new Error("should not call");
    },
    getTask: () => ({ taskId: "t1", status: "WAIT_CLARIFY" }),
    applyAction: async () => ({ task: { taskId: "t1", status: "WAIT_CLARIFY" } })
  };
  const router = createTaskRoutes(mock as never);
  const result = await invokeRoute({
    router,
    method: "post",
    path: "/tasks",
    reqBody: { repo: "org/name" }
  });

  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { error: "trigger_user is required" });
});

test("POST /tasks returns created payload", async () => {
  const mock: MockService = {
    createTask: () => ({
      task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" },
      needsClarify: false
    }),
    getTask: () => ({ taskId: "t1", status: "WAIT_APPROVE_WRITE" }),
    applyAction: async () => ({ task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" } })
  };
  const router = createTaskRoutes(mock as never);
  const result = await invokeRoute({
    router,
    method: "post",
    path: "/tasks",
    reqBody: {
      trigger_user: "tg:1",
      repo: "org/name",
      intent: "fix login 500",
      agent: "codex"
    }
  });

  assert.equal(result.statusCode, 201);
  assert.deepEqual(result.body, {
    task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" },
    next_status: "WAIT_APPROVE_WRITE",
    needs_clarify: false,
    expected_path: null
  });
});

test("GET /tasks/:taskId maps service 404", async () => {
  const mock: MockService = {
    createTask: () => ({
      task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" },
      needsClarify: false
    }),
    getTask: () => {
      throw new TaskServiceError("Task not found: t404", 404);
    },
    applyAction: async () => ({ task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" } })
  };
  const router = createTaskRoutes(mock as never);
  const result = await invokeRoute({
    router,
    method: "get",
    path: "/tasks/:taskId",
    reqParams: { taskId: "t404" }
  });

  assert.equal(result.statusCode, 404);
  assert.deepEqual(result.body, { error: "Task not found: t404" });
});

test("POST /tasks/:taskId/actions maps service conflict", async () => {
  const mock: MockService = {
    createTask: () => ({
      task: { taskId: "t1", status: "WAIT_APPROVE_WRITE" },
      needsClarify: false
    }),
    getTask: () => ({ taskId: "t1", status: "WAIT_APPROVE_WRITE" }),
    applyAction: async () => {
      throw new TaskServiceError("Task t1 is WAIT_CLARIFY, retry is not available.", 409);
    }
  };
  const router = createTaskRoutes(mock as never);
  const result = await invokeRoute({
    router,
    method: "post",
    path: "/tasks/:taskId/actions",
    reqBody: { action: "retry", actor: "tg:1" },
    reqParams: { taskId: "t1" }
  });

  assert.equal(result.statusCode, 409);
  assert.deepEqual(result.body, { error: "Task t1 is WAIT_CLARIFY, retry is not available." });
});

