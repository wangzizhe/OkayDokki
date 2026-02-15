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
    const testsResult = sandboxResult.testExitCode === 0 ? "PASS" : "FAIL";
    const prLink = await this.prCreator.createDraftPr(task);

    return {
      testsResult,
      diffHash,
      agentLogs: sandboxResult.agentLogs,
      agentMeta: sandboxResult.agentMeta,
      prLink
    };
  }
}
