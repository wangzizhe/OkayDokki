import { TaskRepository } from "../repositories/taskRepository.js";
import { TaskRunResult, TaskSpec } from "../types.js";
import { newTaskId } from "../utils/id.js";
import { repoSnapshotExists, resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";
import { AuditLogger } from "./auditLogger.js";
import { TaskRunner } from "./taskRunner.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class TaskServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

export type TaskAction = "retry" | "approve" | "reject";
const TASK_ACTIONS: TaskAction[] = ["retry", "approve", "reject"];

export function isTaskAction(value: string): value is TaskAction {
  return TASK_ACTIONS.includes(value as TaskAction);
}

export interface CreateTaskInput {
  source: "telegram" | "api";
  triggerUser: string;
  repo: string;
  intent: string;
  agent?: string;
}

export interface CreateTaskResult {
  task: TaskSpec;
  needsClarify: boolean;
  expectedPath?: string;
}

export interface ApplyActionResult {
  task: TaskSpec;
  runResult?: TaskRunResult;
}

export class TaskService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly audit: AuditLogger,
    private readonly runner: TaskRunner,
    private readonly repoSnapshotRoot: string
  ) {}

  createTask(input: CreateTaskInput): CreateTaskResult {
    const hasSnapshot = repoSnapshotExists(this.repoSnapshotRoot, input.repo);
    const status = hasSnapshot ? "WAIT_APPROVE_WRITE" : "WAIT_CLARIFY";
    const task: TaskSpec = {
      taskId: newTaskId(),
      source: { im: input.source },
      triggerUser: input.triggerUser,
      repo: input.repo,
      branch: `agent/${Date.now()}`,
      intent: input.intent,
      agent: input.agent ?? "codex",
      status,
      createdAt: nowIso(),
      approvedBy: null
    };

    this.repo.create(task);
    this.audit.append({
      timestamp: nowIso(),
      taskId: task.taskId,
      triggerUser: task.triggerUser,
      eventType: "REQUEST",
      message: task.intent
    });

    if (!hasSnapshot) {
      return {
        task,
        needsClarify: true,
        expectedPath: resolveRepoSnapshotPath(this.repoSnapshotRoot, input.repo)
      };
    }

    return { task, needsClarify: false };
  }

  getTask(taskId: string): TaskSpec {
    const task = this.repo.get(taskId);
    if (!task) {
      throw new TaskServiceError(`Task not found: ${taskId}`, 404);
    }
    return task;
  }

  async applyAction(taskId: string, action: TaskAction, actor: string): Promise<ApplyActionResult> {
    if (!isTaskAction(action)) {
      throw new TaskServiceError(
        `Invalid action: ${String(action)}. Expected one of: retry, approve, reject.`,
        400
      );
    }

    const task = this.getTask(taskId);

    if (action === "retry") {
      if (task.status !== "WAIT_CLARIFY") {
        throw new TaskServiceError(
          `Task ${taskId} is ${task.status}, retry is not available.`,
          409
        );
      }
      const hasSnapshot = repoSnapshotExists(this.repoSnapshotRoot, task.repo);
      if (!hasSnapshot) {
        const expectedPath = resolveRepoSnapshotPath(this.repoSnapshotRoot, task.repo);
        throw new TaskServiceError(
          `Snapshot still missing for '${task.repo}'. Expected path: ${expectedPath}`,
          409
        );
      }
      const updated = this.repo.transition(taskId, "WAIT_APPROVE_WRITE");
      this.audit.append({
        timestamp: nowIso(),
        taskId,
        triggerUser: task.triggerUser,
        eventType: "RETRY",
        message: `Retry by ${actor}`
      });
      return { task: updated };
    }

    if (action === "reject") {
      if (task.status !== "WAIT_CLARIFY" && task.status !== "WAIT_APPROVE_WRITE") {
        throw new TaskServiceError(
          `Task ${taskId} is ${task.status}, reject is only allowed in pending states.`,
          409
        );
      }
      const updated = this.repo.transition(taskId, "FAILED");
      this.audit.append({
        timestamp: nowIso(),
        taskId,
        triggerUser: task.triggerUser,
        eventType: "REJECT",
        approvalDecision: "REJECT",
        message: `Rejected by ${actor}`
      });
      return { task: updated };
    }

    if (task.status !== "WAIT_APPROVE_WRITE") {
      throw new TaskServiceError(
        `Task ${taskId} is ${task.status}, only WAIT_APPROVE_WRITE can be approved.`,
        409
      );
    }

    const approvedTask = this.repo.transition(taskId, "RUNNING", actor);
    this.audit.append({
      timestamp: nowIso(),
      taskId,
      triggerUser: task.triggerUser,
      eventType: "APPROVE",
      approvalDecision: "APPROVE",
      message: `Approved by ${actor}`
    });

    try {
      const runResult = await this.runner.run(approvedTask);
      this.audit.append({
        timestamp: nowIso(),
        taskId,
        triggerUser: task.triggerUser,
        eventType: "RUN",
        diffHash: runResult.diffHash,
        agentLogs: runResult.agentLogs,
        testsResult: runResult.testsResult,
        message:
          Object.keys(runResult.agentMeta).length > 0
            ? `agent_meta=${JSON.stringify(runResult.agentMeta)}`
            : undefined
      });

      if (runResult.prLink) {
        this.repo.transition(taskId, "PR_CREATED");
        this.audit.append({
          timestamp: nowIso(),
          taskId,
          triggerUser: task.triggerUser,
          eventType: "PR_CREATED",
          prLink: runResult.prLink
        });
      }

      const completed = this.repo.transition(taskId, "COMPLETED");
      return { task: completed, runResult };
    } catch (err) {
      const failed = this.repo.transition(taskId, "FAILED");
      this.audit.append({
        timestamp: nowIso(),
        taskId,
        triggerUser: task.triggerUser,
        eventType: "FAILED",
        message: err instanceof Error ? err.message : String(err)
      });
      throw new TaskServiceError(
        `Task ${taskId} failed: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }
  }
}
