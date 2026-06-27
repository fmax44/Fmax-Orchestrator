import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export const codexDirName = ".codex";

export interface CodexPaths {
  root: string;
  codexDir: string;
  tasksDir: string;
  reportsDir: string;
  decisionsDir: string;
  stateDir: string;
  archiveDir: string;
  tasksStatePath: string;
}

export async function resolveProjectPath(projectPath: string): Promise<string> {
  if (!projectPath?.trim()) {
    throw new Error("projectPath is required.");
  }

  const resolved = path.resolve(projectPath);
  const info = await stat(resolved).catch(() => undefined);

  if (!info?.isDirectory()) {
    throw new Error(`projectPath does not exist or is not a directory: ${projectPath}`);
  }

  return resolved;
}

export function getCodexPaths(projectPath: string): CodexPaths {
  const root = path.resolve(projectPath);
  const codexDir = path.join(root, codexDirName);

  return {
    root,
    codexDir,
    tasksDir: path.join(codexDir, "tasks"),
    reportsDir: path.join(codexDir, "reports"),
    decisionsDir: path.join(codexDir, "decisions"),
    stateDir: path.join(codexDir, "state"),
    archiveDir: path.join(codexDir, "archive"),
    tasksStatePath: path.join(codexDir, "state", "tasks.json")
  };
}

export async function ensureCodexStructure(projectPath: string): Promise<CodexPaths> {
  const resolved = await resolveProjectPath(projectPath);
  const paths = getCodexPaths(resolved);

  await Promise.all([
    mkdir(paths.tasksDir, { recursive: true }),
    mkdir(paths.reportsDir, { recursive: true }),
    mkdir(paths.decisionsDir, { recursive: true }),
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.archiveDir, { recursive: true })
  ]);

  return paths;
}

export function toProjectRelative(projectPath: string, targetPath: string): string {
  return path.relative(path.resolve(projectPath), path.resolve(targetPath)).replaceAll(path.sep, "/");
}

export function ensureRelativeInsideProject(projectPath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
    throw new Error(`Path must stay inside projectPath: ${relativePath}`);
  }

  const root = path.resolve(projectPath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes projectPath: ${relativePath}`);
  }

  return target;
}
