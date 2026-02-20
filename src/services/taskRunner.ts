import { createHash } from "node:crypto";
import path from "node:path";
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

  async run(
    task: TaskSpec,
    onProgress?: (stage: "AGENT_RUNNING" | "SANDBOX_TESTING" | "CREATING_PR") => Promise<void> | void
  ): Promise<TaskRunResult> {
    // Execution order is intentional: agent output -> sandbox validation -> diff policy -> draft PR.
    await onProgress?.("AGENT_RUNNING");
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
      await onProgress?.("SANDBOX_TESTING");
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
    const diffSummary = summarizeDiff(hostResult.diff);
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
        await onProgress?.("CREATING_PR");
        const policyChecks = [
          `Blocked paths guard: enabled (${this.diffPolicy.blockedPathPrefixes.join(", ") || "none"})`,
          `Binary patch guard: ${this.diffPolicy.disallowBinaryPatch ? "enabled" : "disabled"}`,
          `Max changed files: ${this.diffPolicy.maxChangedFiles}`,
          `Max diff bytes: ${this.diffPolicy.maxDiffBytes}`
        ];
        prLink = await this.prCreator.createDraftPr(task, hostResult.candidatePath, {
          testsResult,
          changedFiles: diffSummary.changedFiles,
          policyChecks
        });
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
      changedFiles: diffSummary.changedFiles,
      insertions: diffSummary.insertions,
      deletions: diffSummary.deletions,
      agentLogs: hostResult.agentLogs,
      agentMeta: hostResult.agentMeta,
      prLink
    };
  }
}

function summarizeDiff(diff: string): { changedFiles: string[]; insertions: number; deletions: number } {
  // Supports both git-style and diff -ruN output so summaries remain stable across adapters.
  const changed = new Set<string>();
  let insertions = 0;
  let deletions = 0;

  for (const rawLine of diff.split("\n")) {
    const line = rawLine.trimEnd();
    const gitMatch = line.match(/^diff --git a\/(.+)\s+b\/(.+)$/);
    if (gitMatch) {
      changed.add(gitMatch[2] ?? gitMatch[1]);
      continue;
    }
    const ruMatch = line.match(/^diff -ruN\s+(.+)\s+(.+)$/);
    if (ruMatch) {
      const parsed = normalizePathFromRuDiff(ruMatch[2] ?? ruMatch[1] ?? "");
      changed.add(parsed);
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      insertions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return {
    changedFiles: Array.from(changed),
    insertions,
    deletions
  };
}

function normalizePathFromRuDiff(rawPath: string): string {
  const cleaned = rawPath.replace(/^"+|"+$/g, "").trim();
  if (!cleaned) {
    return "unknown-file";
  }
  const normalized = cleaned.replace(/\\/g, "/");

  const workMarker = "/work/";
  const workIdx = normalized.indexOf(workMarker);
  if (workIdx >= 0) {
    const rel = normalized.slice(workIdx + workMarker.length);
    return rel || "unknown-file";
  }
  if (normalized.startsWith("work/")) {
    const rel = normalized.slice("work/".length);
    return rel || "unknown-file";
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return path.basename(normalized);
}
