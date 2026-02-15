import fs from "node:fs";
import path from "node:path";

export function resolveRepoSnapshotPath(repoRoot: string, repo: string): string {
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, repo);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Invalid repo path: ${repo}`);
  }
  return resolved;
}

export function repoSnapshotExists(repoRoot: string, repo: string): boolean {
  const resolved = resolveRepoSnapshotPath(repoRoot, repo);
  return fs.existsSync(resolved);
}

