import { TaskRepository } from "../repositories/taskRepository.js";
import { DeliveryStrategy, TaskRunResult, TaskSpec } from "../types.js";
import { newTaskId } from "../utils/id.js";
import { AuditLogger } from "./auditLogger.js";
import { TaskRunner } from "./taskRunner.js";
import { TaskRunnerError } from "./taskRunner.js";
import { RepoRuntimeResolution, resolveRepoRuntime } from "./repoRuntime.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class TaskServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code:
      | "VALIDATION_ERROR"
      | "TASK_NOT_FOUND"
      | "INVALID_ACTION"
      | "STATE_CONFLICT"
      | "SNAPSHOT_MISSING"
      | "RUNTIME_CONFIG_MISSING"
      | "TEST_FAILED"
      | "AGENT_FAILED"
      | "SANDBOX_FAILED"
      | "PR_CREATE_FAILED"
      | "POLICY_VIOLATION"
      | "RUN_FAILED"
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
  deliveryStrategy?: DeliveryStrategy;
  baseBranch?: string;
}

export interface CreateTaskResult {
  task: TaskSpec;
  needsClarify: boolean;
  expectedPath?: string;
  runtimeConfigPath?: string;
  clarifyReason?: "SNAPSHOT_MISSING" | "RUNTIME_CONFIG_MISSING";
  missingFields?: string[];
}

export interface ApplyActionResult {
  task: TaskSpec;
  runResult?: TaskRunResult;
}

export interface ListTasksResult {
  tasks: TaskSpec[];
}

type RunStage = "QUEUED" | "AGENT_RUNNING" | "SANDBOX_TESTING" | "CREATING_PR" | "COMPLETED" | "FAILED";

export class TaskService {
  private readonly runningApprovals = new Set<string>();
  private readonly progressByTask = new Map<string, RunStage>();

  constructor(
    private readonly repo: TaskRepository,
    private readonly audit: AuditLogger,
    private readonly runner: TaskRunner,
    private readonly repoSnapshotRoot: string,
    private readonly defaults: { deliveryStrategy: DeliveryStrategy; baseBranch: string; agent?: string }
  ) {}

  getRepoRuntime(repo: string): RepoRuntimeResolution {
    return resolveRepoRuntime(this.repoSnapshotRoot, repo, {
      sandboxImage: process.env.SANDBOX_IMAGE ?? "node:22-bookworm-slim",
      testCommand: process.env.DEFAULT_TEST_COMMAND ?? "npm test",
      allowedTestCommands: (process.env.ALLOWED_TEST_COMMANDS ?? "npm test")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    });
  }

  createTask(input: CreateTaskInput): CreateTaskResult {
    const runtime = this.getRepoRuntime(input.repo);
    const needsRuntimeClarify = runtime.missingFields.length > 0;
    // Tasks are runnable only when both repo snapshot and repo-level runtime config are ready.
    const status = runtime.snapshotExists && !needsRuntimeClarify ? "WAIT_APPROVE_WRITE" : "WAIT_CLARIFY";
    const task: TaskSpec = {
      taskId: newTaskId(),
      source: { im: input.source },
      triggerUser: input.triggerUser,
      repo: input.repo,
      branch: `agent/${Date.now()}`,
      intent: input.intent,
      agent: input.agent ?? this.defaults.agent ?? "codex",
      status,
      createdAt: nowIso(),
      approvedBy: null,
      deliveryStrategy: input.deliveryStrategy ?? this.defaults.deliveryStrategy,
      baseBranch: input.baseBranch ?? this.defaults.baseBranch
    };

    this.repo.create(task);
    this.audit.append({
      timestamp: nowIso(),
      taskId: task.taskId,
      triggerUser: task.triggerUser,
      eventType: "REQUEST",
      message: task.intent
    });

    if (!runtime.snapshotExists || needsRuntimeClarify) {
      return {
        task,
        needsClarify: true,
        expectedPath: runtime.repoPath,
        runtimeConfigPath: runtime.configPath,
        clarifyReason: runtime.snapshotExists ? "RUNTIME_CONFIG_MISSING" : "SNAPSHOT_MISSING",
        missingFields: runtime.missingFields
      };
    }

    return { task, needsClarify: false };
  }

  listTasks(limit = 20): ListTasksResult {
    const safeLimit = Number.isFinite(limit) ? limit : 20;
    const capped = Math.max(1, Math.min(safeLimit, 100));
    return {
      tasks: this.repo.listRecent(capped)
    };
  }

  rerunTask(taskId: string, actor: string, source: "telegram" | "api"): CreateTaskResult {
    const original = this.getTask(taskId);
    return this.createTask({
      source,
      triggerUser: actor,
      repo: original.repo,
      intent: original.intent,
      agent: original.agent,
      deliveryStrategy: original.deliveryStrategy ?? this.defaults.deliveryStrategy,
      baseBranch: original.baseBranch ?? this.defaults.baseBranch
    });
  }

  getTask(taskId: string): TaskSpec {
    const task = this.repo.get(taskId);
    if (!task) {
      throw new TaskServiceError(`Task not found: ${taskId}`, 404, "TASK_NOT_FOUND");
    }
    return task;
  }

  getTaskProgress(taskId: string): RunStage | null {
    return this.progressByTask.get(taskId) ?? null;
  }

  async applyAction(
    taskId: string,
    action: TaskAction,
    actor: string,
    onProgress?: (stage: "AGENT_RUNNING" | "SANDBOX_TESTING" | "CREATING_PR") => Promise<void> | void
  ): Promise<ApplyActionResult> {
    if (!isTaskAction(action)) {
      throw new TaskServiceError(
        `Invalid action: ${String(action)}. Expected one of: retry, approve, reject.`,
        400,
        "INVALID_ACTION"
      );
    }

    const task = this.getTask(taskId);

    if (action === "retry") {
      if (task.status !== "WAIT_CLARIFY") {
        throw new TaskServiceError(
          `Task ${taskId} is ${task.status}, retry is not available.`,
          409,
          "STATE_CONFLICT"
        );
      }
      const runtime = this.getRepoRuntime(task.repo);
      if (!runtime.snapshotExists) {
        throw new TaskServiceError(
          `Snapshot still missing for '${task.repo}'. Expected path: ${runtime.repoPath}`,
          409,
          "SNAPSHOT_MISSING"
        );
      }
      if (runtime.missingFields.length > 0) {
        throw new TaskServiceError(
          `Runtime config missing for '${task.repo}'. Required fields: ${runtime.missingFields.join(", ")} (${runtime.configPath})`,
          409,
          "RUNTIME_CONFIG_MISSING"
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
          409,
          "STATE_CONFLICT"
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
        409,
        "STATE_CONFLICT"
      );
    }
    if (this.runningApprovals.has(taskId)) {
      throw new TaskServiceError(
        `Task ${taskId} is already running.`,
        409,
        "STATE_CONFLICT"
      );
    }
    this.runningApprovals.add(taskId);
    // In-process lock prevents duplicate callback taps from starting the same task twice.
    this.progressByTask.set(taskId, "QUEUED");

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
      // Service bridges runner progress stages to gateway notifications and task status introspection.
      const runResult = await this.runner.run(approvedTask, async (stage) => {
        this.progressByTask.set(taskId, stage);
        await onProgress?.(stage);
      });
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

      if (runResult.testsResult !== "PASS") {
        throw new TaskServiceError(
          `Tests failed. ${runResult.testLog || "See sandbox test logs."}`,
          500,
          "TEST_FAILED"
        );
      }

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
      this.progressByTask.set(taskId, "COMPLETED");
      return { task: completed, runResult };
    } catch (err) {
      let errorCode: TaskServiceError["code"] = "RUN_FAILED";
      if (err instanceof TaskServiceError) {
        errorCode = err.code;
      } else if (err instanceof TaskRunnerError) {
        errorCode = err.code;
      }

      const failed = this.repo.transition(taskId, "FAILED");
      this.progressByTask.set(taskId, "FAILED");
      this.audit.append({
        timestamp: nowIso(),
        taskId,
        triggerUser: task.triggerUser,
        eventType: "FAILED",
        errorCode,
        message: err instanceof Error ? err.message : String(err)
      });
      if (err instanceof TaskServiceError) {
        throw err;
      }
      if (err instanceof TaskRunnerError) {
        throw new TaskServiceError(
          `Task ${taskId} failed: ${err.message}`,
          500,
          err.code
        );
      }
      throw new TaskServiceError(
        `Task ${taskId} failed: ${err instanceof Error ? err.message : String(err)}`,
        500,
        "RUN_FAILED"
      );
    } finally {
      this.runningApprovals.delete(taskId);
    }
  }
}
