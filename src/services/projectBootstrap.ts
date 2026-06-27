import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeExec } from "../utils/safeExec.js";
import { getCodexPaths, resolveProjectPath } from "../utils/paths.js";
import { TaskStore } from "./taskStore.js";

export interface BootstrapResult {
  projectPath: string;
  isGitRepo: boolean;
  codexCreated: boolean;
  tasksStateCreated: boolean;
  codexReadmeCreated: boolean;
  gitignoreUpdated: boolean;
  codexTracked: boolean;
  warnings: string[];
}

export class ProjectBootstrap {
  constructor(private readonly taskStore = new TaskStore()) {}

  async bootstrap(projectPath: string): Promise<BootstrapResult> {
    const root = await resolveProjectPath(projectPath);
    const paths = getCodexPaths(root);
    const codexExisted = await exists(paths.codexDir);
    const tasksStateExisted = await exists(paths.tasksStatePath);
    const readmePath = path.join(paths.codexDir, "README.md");
    const codexReadmeExisted = await exists(readmePath);
    const isGitRepo = await this.isGitRepo(root);

    if (!isGitRepo) {
      throw new Error(`Project must be a Git repository before bootstrap: ${root}`);
    }

    await this.taskStore.ensureStructure(root);
    await writeCodexReadme(readmePath, root, codexReadmeExisted);
    const gitignoreUpdated = await ensureGitignoreHasCodex(root);
    const codexTracked = await isCodexTracked(root);
    const warnings: string[] = [];

    if (codexTracked) {
      warnings.push(".codex is tracked by Git. Remove it from Git tracking before using real project workflows.");
    }

    return {
      projectPath: root,
      isGitRepo,
      codexCreated: !codexExisted,
      tasksStateCreated: !tasksStateExisted,
      codexReadmeCreated: !codexReadmeExisted,
      gitignoreUpdated,
      codexTracked,
      warnings
    };
  }

  private async isGitRepo(projectPath: string): Promise<boolean> {
    const result = await safeExec(projectPath, "git rev-parse --is-inside-work-tree", { maxOutputBytes: 1_000 });
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }
}

async function ensureGitignoreHasCodex(projectPath: string): Promise<boolean> {
  const gitignorePath = path.join(projectPath, ".gitignore");
  const current = await readFile(gitignorePath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }

    throw error;
  });
  const hasCodex = current
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".codex" || line === ".codex/");

  if (hasCodex) {
    return false;
  }

  const next = current.trimEnd() ? `${current.trimEnd()}\n.codex/\n` : ".codex/\n";
  await writeFile(gitignorePath, next, "utf8");
  return true;
}

async function writeCodexReadme(readmePath: string, projectPath: string, existed: boolean): Promise<void> {
  if (existed) {
    return;
  }

  await writeFile(
    readmePath,
    [
      "# Local Codex Workflow",
      "",
      `Project: ${projectPath}`,
      "",
      "This directory is managed by chatgpt-codex-mcp.",
      "",
      "- Tasks are stored in `tasks/`.",
      "- Codex reports are stored in `reports/`.",
      "- Architect decisions are stored in `decisions/`.",
      "- Task state is stored in `state/tasks.json`.",
      "- Archived tasks are moved to `archive/`.",
      "",
      "Do not commit this directory unless your team explicitly decides otherwise.",
      ""
    ].join("\n"),
    "utf8"
  );
}

async function isCodexTracked(projectPath: string): Promise<boolean> {
  const result = await safeExec(projectPath, "git ls-files .codex", { maxOutputBytes: 4_000 });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
