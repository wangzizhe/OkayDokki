export interface DiffPolicyOptions {
  blockedPathPrefixes: string[];
  maxChangedFiles: number;
  maxDiffBytes: number;
  disallowBinaryPatch: boolean;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/^\.?\//, "");
}

function extractPathFromPlusLine(line: string): string | null {
  const token = line.replace(/^\+\+\+\s+/, "").split("\t")[0]?.trim();
  if (!token || token === "/dev/null") {
    return null;
  }
  if (token.startsWith("/work/")) {
    return normalizePath(token.slice("/work/".length));
  }
  if (token.startsWith("b/")) {
    return normalizePath(token.slice(2));
  }
  return null;
}

function extractPathFromBinaryLine(line: string): string | null {
  const match = line.match(/^Binary files\s+(.+)\s+and\s+(.+)\s+differ$/);
  if (!match) {
    return null;
  }
  const rhs = (match[2] ?? "").trim().replace(/^"+|"+$/g, "");
  if (!rhs) {
    return null;
  }
  const normalized = rhs.replace(/\\/g, "/");
  if (normalized.startsWith("/work/")) {
    return normalizePath(normalized.slice("/work/".length));
  }
  if (normalized.startsWith("b/")) {
    return normalizePath(normalized.slice(2));
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return normalized;
}

export function extractChangedFiles(diff: string): string[] {
  const files = new Set<string>();
  for (const rawLine of diff.split("\n")) {
    const line = rawLine.trim();
    const gitMatch = line.match(/^diff --git a\/(.+)\s+b\/(.+)$/);
    if (gitMatch) {
      const right = gitMatch[2] === "/dev/null" ? gitMatch[1] : gitMatch[2];
      files.add(normalizePath(right));
      continue;
    }
    if (line.startsWith("+++ ")) {
      const file = extractPathFromPlusLine(line);
      if (file) {
        files.add(file);
      }
      continue;
    }
    if (line.startsWith("Binary files ")) {
      const file = extractPathFromBinaryLine(line);
      if (file) {
        files.add(file);
      }
    }
  }
  return [...files];
}

export function evaluateDiffPolicy(diff: string, options: DiffPolicyOptions): string[] {
  const violations: string[] = [];
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes > options.maxDiffBytes) {
    violations.push(`diff size ${diffBytes} exceeds maxDiffBytes ${options.maxDiffBytes}`);
  }

  const changedFiles = extractChangedFiles(diff);
  if (changedFiles.length > options.maxChangedFiles) {
    violations.push(
      `changed file count ${changedFiles.length} exceeds maxChangedFiles ${options.maxChangedFiles}`
    );
  }

  for (const file of changedFiles) {
    const matchedPrefix = options.blockedPathPrefixes.find((prefix) =>
      normalizePath(file).startsWith(normalizePath(prefix))
    );
    if (matchedPrefix) {
      violations.push(`blocked path modified: ${file} (prefix: ${matchedPrefix})`);
    }
  }

  if (
    options.disallowBinaryPatch &&
    /(GIT binary patch|Binary files .* differ)/m.test(diff)
  ) {
    const binaryFiles = diff
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("Binary files "))
      .map(extractPathFromBinaryLine)
      .filter((value): value is string => Boolean(value));
    const sample = binaryFiles.slice(0, 3);
    if (sample.length > 0) {
      violations.push(`binary patch content is not allowed (files: ${sample.join(", ")})`);
    } else {
      violations.push("binary patch content is not allowed");
    }
  }

  return violations;
}
