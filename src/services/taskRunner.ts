import { createHash } from "node:crypto";
import { AgentAdapter } from "../adapters/agent/agentAdapter.js";
import { TaskRunResult, TaskSpec } from "../types.js";
import { PrCreator } from "./prCreator.js";
import { DockerSandbox } from "./dockerSandbox.js";

export class TaskRunner {
  constructor(
    private readonly agentAdapter: AgentAdapter,
    private readonly sandbox: DockerSandbox,
    private readonly prCreator: PrCreator
  ) {}

  async run(task: TaskSpec): Promise<TaskRunResult> {
    const agentCommand = this.agentAdapter.buildCommand(task);
    const sandboxResult = await this.sandbox.runTask(task, agentCommand);
    if (sandboxResult.agentExitCode !== 0) {
      throw new Error(`Agent command failed with exit code ${sandboxResult.agentExitCode}`);
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
