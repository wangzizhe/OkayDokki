import express from "express";
import { TaskAction, TaskService, TaskServiceError, isTaskAction } from "../services/taskService.js";

type CreateTaskBody = {
  trigger_user?: string;
  repo?: string;
  intent?: string;
  agent?: string;
};

type ActionBody = {
  action?: string;
  actor?: string;
};

function badRequest(message: string): never {
  throw new TaskServiceError(message, 400, "VALIDATION_ERROR");
}

export function createTaskRoutes(service: TaskService): express.Router {
  const router = express.Router();

  router.post("/tasks", (req, res) => {
    try {
      const body = req.body as CreateTaskBody;
      if (!body.trigger_user) {
        badRequest("trigger_user is required");
      }
      if (!body.repo) {
        badRequest("repo is required");
      }
      if (!body.intent) {
        badRequest("intent is required");
      }

      const created = service.createTask({
        source: "api",
        triggerUser: body.trigger_user,
        repo: body.repo,
        intent: body.intent,
        agent: body.agent ?? "codex"
      });

      res.status(201).json({
        task: created.task,
        next_status: created.task.status,
        needs_clarify: created.needsClarify,
        expected_path: created.expectedPath ?? null
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/tasks/:taskId", (req, res) => {
    try {
      const task = service.getTask(req.params.taskId);
      res.status(200).json({ task });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/tasks/:taskId/actions", async (req, res) => {
    try {
      const body = req.body as ActionBody;
      if (!body.action) {
        badRequest("action is required");
      }
      if (!isTaskAction(body.action)) {
        badRequest("action must be one of: retry, approve, reject");
      }
      if (!body.actor) {
        badRequest("actor is required");
      }

      const result = await service.applyAction(req.params.taskId, body.action, body.actor);
      res.status(200).json({
        task: result.task,
        run_result: result.runResult ?? null
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  return router;
}

function sendError(res: express.Response, err: unknown): void {
  if (err instanceof TaskServiceError) {
    res.status(err.statusCode).json({ error: err.message, error_code: err.code });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error", error_code: "UNKNOWN" });
}
