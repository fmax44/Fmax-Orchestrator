import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { safeExec } from "../utils/safeExec.js";
import { getCodexPaths } from "../utils/paths.js";

export interface ProjectHealth {
  projectPath: string;
  exists: boolean;
  isGitRepo: boolean;
  gitStatusClean: boolean;
  codexDirExists: boolean;
  tasksStateExists: boolean;
  gitignoreHasCodex: boolean;
  packageManager: string | null;
  availableChecks: string[];
  warnings: string[];
  ready: boolean;
}

export class ProjectHealthService {
  async check(projectPath: string): Promise<ProjectHealth> {
    const root = path.resolve(projectPath);
    const exists = await isDirectory(root);
    const warnings: string[] = [];

    if (!exists) {
      return {
        projectPath: root,
        exists: false,
        isGitRepo: false,
        gitStatusClean: false,
        codexDirExists: false,
        tasksStateExists: false,
        gitignoreHasCodex: false,
        packageManager: null,
        availableChecks: [],
        warnings: [`Project path does not exist: ${root}`],
        ready: false
      };
    }

    const paths = getCodexPaths(root);
    const isGitRepo = await gitIsRepo(root);
    const gitStatus = isGitRepo ? await safeExec(root, "git status --short", { maxOutputBytes: 20_000 }) : undefined;
    const gitStatusClean = Boolean(isGitRepo && gitStatus?.exitCode === 0 && gitStatus.stdout.trim().length === 0);
    const codexDirExists = await isDirectory(paths.codexDir);
    const tasksStateExists = await fileExists(paths.tasksStatePath);
    const gitignoreHasCodex = await hasCodexGitignore(root);
    const packageInfo = await detectPackage(root);

    if (!isGitRepo) warnings.push("Project is not a Git repository.");
    if (isGitRepo && !gitStatusClean) warnings.push("Git working tree is not clean.");
    if (!codexDirExists) warnings.push(".codex directory is missing. Run npm run bootstrap -- --project <path>.");
    if (!tasksStateExists) warnings.push(".codex/state/tasks.json is missing.");
    if (!gitignoreHasCodex) warnings.push(".gitignore does not contain .codex/.");
    if (!packageInfo.packageManager) warnings.push("No known package manager lockfile or package.json was found.");
    if (!packageInfo.availableChecks.length) warnings.push("No common build/test/lint scripts were detected.");

    return {
      projectPath: root,
      exists,
      isGitRepo,
      gitStatusClean,
      codexDirExists,
      tasksStateExists,
      gitignoreHasCodex,
      packageManager: packageInfo.packageManager,
      availableChecks: packageInfo.availableChecks,
      warnings,
      ready: warnings.length === 0
    };
  }
}

async function gitIsRepo(projectPath: string): Promise<boolean> {
  const result = await safeExec(projectPath, "git rev-parse --is-inside-work-tree", { maxOutputBytes: 1_000 });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

async function detectPackage(projectPath: string): Promise<{ packageManager: string | null; availableChecks: string[] }> {
  const packageJsonPath = path.join(projectPath, "package.json");
  const packageJson = await readFile(packageJsonPath, "utf8").catch(() => undefined);

  if (!packageJson) {
    return { packageManager: null, availableChecks: [] };
  }

  const parsed = JSON.parse(packageJson) as { scripts?: Record<string, string> };
  const scripts = parsed.scripts ?? {};
  const availableChecks = ["build", "test", "lint"]
    .filter((script) => scripts[script])
    .map((script) => (script === "test" ? "npm test" : `npm run ${script}`));

  if (await fileExists(path.join(projectPath, "pnpm-lock.yaml"))) {
    return { packageManager: "pnpm", availableChecks };
  }

  if (await fileExists(path.join(projectPath, "yarn.lock"))) {
    return { packageManager: "yarn", availableChecks };
  }

  return { packageManager: "npm", availableChecks };
}

async function hasCodexGitignore(projectPath: string): Promise<boolean> {
  const content = await readFile(path.join(projectPath, ".gitignore"), "utf8").catch(() => "");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === ".codex" || line === ".codex/");
}

async function isDirectory(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then((info) => info.isDirectory())
    .catch(() => false);
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}
