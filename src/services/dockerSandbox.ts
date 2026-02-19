import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TaskSpec } from "../types.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";

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

type SandboxRuntimeOptions = {
  image: string;
  defaultTestCommand: string;
  allowedTestCommands: string[];
};

export class DockerSandbox {
  constructor(private readonly options: DockerSandboxOptions) {}

  async runValidation(task: TaskSpec, candidatePath: string): Promise<SandboxExecutionResult> {
    const hostRepoPath = this.resolveRepoPath(task.repo);
    const runtime = this.resolveRuntimeOptions(hostRepoPath);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `okaydokki-${task.taskId}-`));
    const workDir = path.join(tempDir, "work");
    const outDir = path.join(tempDir, "out");
    fs.mkdirSync(workDir, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });

    const testCommand = this.assertAllowedTestCommand(runtime.defaultTestCommand, runtime.allowedTestCommands);

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
        runtime.image,
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

  private resolveRuntimeOptions(repoPath: string): SandboxRuntimeOptions {
    const filePath = path.join(repoPath, "okaydokki.yaml");
    if (!fs.existsSync(filePath)) {
      return {
        image: this.options.image,
        defaultTestCommand: this.options.defaultTestCommand,
        allowedTestCommands: this.options.allowedTestCommands
      };
    }

    const parsed = this.parseSimpleYaml(fs.readFileSync(filePath, "utf8"));
    const image = this.readString(parsed.sandbox_image) ?? this.options.image;
    const defaultTestCommand = this.readString(parsed.test_command) ?? this.options.defaultTestCommand;
    const parsedAllowed = this.readStringList(parsed.allowed_test_commands);
    const allowedTestCommands = parsedAllowed.length > 0 ? parsedAllowed : this.options.allowedTestCommands;
    return {
      image,
      defaultTestCommand,
      allowedTestCommands
    };
  }

  private parseSimpleYaml(raw: string): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const lines = raw.split("\n");
    let listKey: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const listMatch = line.match(/^- (.+)$/);
      if (listKey && listMatch) {
        const current = out[listKey];
        if (!Array.isArray(current)) {
          out[listKey] = [];
        }
        (out[listKey] as string[]).push(this.stripQuotes(listMatch[1] ?? ""));
        continue;
      }

      const sep = line.indexOf(":");
      if (sep < 0) {
        continue;
      }
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (!key) {
        continue;
      }
      if (value === "") {
        out[key] = [];
        listKey = key;
        continue;
      }
      out[key] = this.stripQuotes(value);
      listKey = null;
    }

    return out;
  }

  private stripQuotes(value: string): string {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  private readString(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  }

  private readStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  private readFileSafe(filePath: string): string {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  }

}
