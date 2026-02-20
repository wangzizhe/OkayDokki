import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";
import { resolveRepoRuntime } from "./repoRuntime.js";

const execFileAsync = promisify(execFile);

export interface SandboxExecutionResult {
  testExitCode: number;
  testLog: string;
}

export interface DockerSandboxOptions {
  image: string;
  repoRoot: string;
  allowedTestCommands: string[];
  defaultTestCommand: string;
}

export class DockerSandbox {
  constructor(private readonly options: DockerSandboxOptions) {}

  async runValidation(task: TaskSpec, candidatePath: string): Promise<SandboxExecutionResult> {
    const hostRepoPath = this.resolveRepoPath(task.repo);
    const runtime = resolveRepoRuntime(this.options.repoRoot, task.repo, {
      sandboxImage: this.options.image,
      testCommand: this.options.defaultTestCommand,
      allowedTestCommands: this.options.allowedTestCommands
    });
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `okaydokki-${task.taskId}-`));
    const workDir = path.join(tempDir, "work");
    const outDir = path.join(tempDir, "out");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    const testCommand = this.assertAllowedTestCommand(runtime.testCommand, runtime.allowedTestCommands);

    const script = [
      "set -eu",
      "tar -C /repo --exclude=.git -cf - . | tar -C /work -xf -",
      "tar -C /candidate --exclude=.git -cf - . | tar -C /work -xf -",
      "cd /work",
      "TEST_STATUS=0",
      "if [ -n \"${TEST_CMD:-}\" ]; then",
      "  sh -lc \"$TEST_CMD\" > /out/test.log 2>&1 || TEST_STATUS=$?",
      "else",
      "  echo \"test skipped\" > /out/test.log",
      "fi",
      "echo \"$TEST_STATUS\" > /out/test.exit"
    ].join("\n");

    let dockerError: unknown = null;
    try {
      await execFileAsync("docker", [
        "run",
        "--rm",
        "--network",
        "none",
        "-v",
        `${hostRepoPath}:/repo:ro`,
        "-v",
        `${candidatePath}:/candidate:ro`,
        "-v",
        `${workDir}:/work`,
        "-v",
        `${outDir}:/out`,
        "-e",
        `TEST_CMD=${testCommand}`,
        runtime.sandboxImage,
        "sh",
        "-lc",
        script
      ]);
    } catch (err) {
      dockerError = err;
    }

    const testLog = this.readFileSafe(path.join(outDir, "test.log"));
    const testExitCode = Number(this.readFileSafe(path.join(outDir, "test.exit")).trim() || "1");

    fs.rmSync(tempDir, { recursive: true, force: true });

    if (dockerError) {
      const msg = dockerError instanceof Error ? dockerError.message : String(dockerError);
      throw new Error(`Docker sandbox execution failed: ${msg}`);
    }

    return {
      testExitCode,
      testLog
    };
  }

  private resolveRepoPath(repo: string): string {
    const resolved = resolveRepoSnapshotPath(this.options.repoRoot, repo);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Repo snapshot not found: ${resolved}`);
    }
    return resolved;
  }

  private assertAllowedTestCommand(command: string, allowedCommands: string[]): string {
    if (!allowedCommands.includes(command)) {
      throw new Error(`Test command is not allowed: ${command}`);
    }
    return command;
  }

  private readFileSafe(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }

}
