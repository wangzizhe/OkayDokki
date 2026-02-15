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
    violations.push("binary patch content is not allowed");
  }

  return violations;
}

