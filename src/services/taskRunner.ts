import { createHash } from "node:crypto";
import { AgentAdapter } from "../adapters/agent/agentAdapter.js";
import { TaskRunResult, TaskSpec } from "../types.js";
import { PrCreator } from "./prCreator.js";
import { DockerSandbox } from "./dockerSandbox.js";

export type TaskRunnerErrorCode = "SANDBOX_FAILED" | "AGENT_FAILED";

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
    private readonly sandbox: DockerSandbox,
    private readonly prCreator: PrCreator
  ) {}

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const agentCommand = this.agentAdapter.buildCommand(task);
    let sandboxResult;
    try {
      sandboxResult = await this.sandbox.runTask(task, agentCommand);
    } catch (err) {
      throw new TaskRunnerError(
        `Sandbox execution failed: ${err instanceof Error ? err.message : String(err)}`,
        "SANDBOX_FAILED"
      );
    }

    if (sandboxResult.agentExitCode !== 0) {
      throw new TaskRunnerError(
        `Agent command failed with exit code ${sandboxResult.agentExitCode}`,
        "AGENT_FAILED"
      );
    }

    const diffHash = createHash("sha256").update(sandboxResult.diff).digest("hex");
    const hasDiff = sandboxResult.diff.trim().length > 0;
    const testsResult = sandboxResult.testExitCode === 0 ? "PASS" : "FAIL";
    const prLink = hasDiff ? await this.prCreator.createDraftPr(task) : null;

    return {
      testsResult,
      testLog: sandboxResult.testLog,
      diffHash,
      hasDiff,
      agentLogs: sandboxResult.agentLogs,
      agentMeta: sandboxResult.agentMeta,
      prLink
    };
  }
}
