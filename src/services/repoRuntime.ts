import fs from "node:fs";
import path from "node:path";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";

export type RepoRuntimeFallback = {
  sandboxImage: string;
  testCommand: string;
  allowedTestCommands: string[];
};

export type RepoRuntimeResolution = {
  repoPath: string;
  configPath: string;
  snapshotExists: boolean;
  configExists: boolean;
  missingFields: string[];
  sandboxImage: string;
  testCommand: string;
  allowedTestCommands: string[];
};

export function resolveRepoRuntime(
  repoRoot: string,
  repo: string,
  fallback: RepoRuntimeFallback
): RepoRuntimeResolution {
  const repoPath = resolveRepoSnapshotPath(repoRoot, repo);
  const snapshotExists = fs.existsSync(repoPath);
  const configPath = path.join(repoPath, "okaydokki.yaml");
  const configExists = snapshotExists && fs.existsSync(configPath);

  let sandboxImage = fallback.sandboxImage;
  let testCommand = fallback.testCommand;
  let allowedTestCommands = fallback.allowedTestCommands;
  const missingFields: string[] = [];

  if (!configExists) {
    missingFields.push("okaydokki.yaml");
  } else {
    const parsed = parseSimpleYaml(fs.readFileSync(configPath, "utf8"));
    const parsedImage = asNonEmptyString(parsed.sandbox_image);
    const parsedCommand = asNonEmptyString(parsed.test_command);
    const parsedAllowed = asStringList(parsed.allowed_test_commands);

    if (!parsedImage) {
      missingFields.push("sandbox_image");
    } else {
      sandboxImage = parsedImage;
    }
    if (!parsedCommand) {
      missingFields.push("test_command");
    } else {
      testCommand = parsedCommand;
    }
    if (parsedAllowed.length === 0) {
      missingFields.push("allowed_test_commands");
    } else {
      allowedTestCommands = parsedAllowed;
    }
  }

  return {
    repoPath,
    configPath,
    snapshotExists,
    configExists,
    missingFields,
    sandboxImage,
    testCommand,
    allowedTestCommands
  };
}

function parseSimpleYaml(raw: string): Record<string, unknown> {
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
      (out[listKey] as string[]).push(stripQuotes(listMatch[1] ?? ""));
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
    out[key] = stripQuotes(value);
    listKey = null;
  }

  return out;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}
