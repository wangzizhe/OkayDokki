import { createHash } from "node:crypto";
import { AgentAdapter } from "../adapters/agent/agentAdapter.js";
import { TaskRunResult, TaskSpec } from "../types.js";
import { PrCreator, PrCreatorError } from "./prCreator.js";
import { DockerSandbox } from "./dockerSandbox.js";
import { DiffPolicyOptions, evaluateDiffPolicy } from "./diffPolicy.js";
import { HostAgentExecutor } from "./hostAgentExecutor.js";

export type TaskRunnerErrorCode =
  | "SANDBOX_FAILED"
  | "AGENT_FAILED"
  | "POLICY_VIOLATION"
  | "PR_CREATE_FAILED";

export class TaskRunnerError extends Error {
  constructor(
    message: string,
    public readonly code: TaskRunnerErrorCode
  ) {
    super(message);
  }
}

export class TaskRunner {
  constructor(
    private readonly agentAdapter: AgentAdapter,
    private readonly hostExecutor: HostAgentExecutor,
    private readonly sandbox: DockerSandbox,
    private readonly prCreator: PrCreator,
    private readonly diffPolicy: DiffPolicyOptions
  ) {}

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const agentCommand = this.agentAdapter.buildCommand(task);
    let hostResult;
    try {
      hostResult = await this.hostExecutor.run(task, agentCommand);
    } catch (err) {
      throw new TaskRunnerError(
        `Agent execution failed: ${err instanceof Error ? err.message : String(err)}`,
        "AGENT_FAILED"
      );
    }

    let sandboxResult;
    try {
      sandboxResult = await this.sandbox.runValidation(task, hostResult.candidatePath);
    } catch (err) {
      hostResult.cleanup();
      throw new TaskRunnerError(
        `Sandbox execution failed: ${err instanceof Error ? err.message : String(err)}`,
        "SANDBOX_FAILED"
      );
    }

    const diffHash = createHash("sha256").update(hostResult.diff).digest("hex");
    const hasDiff = hostResult.diff.trim().length > 0;
    if (hasDiff) {
      const violations = evaluateDiffPolicy(hostResult.diff, this.diffPolicy);
      if (violations.length > 0) {
        hostResult.cleanup();
        throw new TaskRunnerError(
          `Diff policy violation: ${violations.join("; ")}`,
          "POLICY_VIOLATION"
        );
      }
    }
    const testsResult = sandboxResult.testExitCode === 0 ? "PASS" : "FAIL";
    let prLink: string | null = null;
    if (hasDiff) {
      try {
        prLink = await this.prCreator.createDraftPr(task, hostResult.candidatePath);
      } catch (err) {
        hostResult.cleanup();
        const msg = err instanceof PrCreatorError ? err.message : String(err);
        throw new TaskRunnerError(`Draft PR creation failed: ${msg}`, "PR_CREATE_FAILED");
      }
    }
    hostResult.cleanup();

    return {
      testsResult,
      testLog: sandboxResult.testLog,
      diffHash,
      hasDiff,
      agentLogs: hostResult.agentLogs,
      agentMeta: hostResult.agentMeta,
      prLink
    };
  }
}
