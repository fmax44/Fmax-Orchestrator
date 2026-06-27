import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { ProjectHealthService } from "../src/services/projectHealth.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("ProjectBootstrap", () => {
  it("bootstraps a new git project and updates .gitignore", async () => {
    const projectPath = await tempProject();
    await initGit(projectPath);

    const result = await new ProjectBootstrap().bootstrap(projectPath);

    expect(result.isGitRepo).toBe(true);
    expect(result.codexCreated).toBe(true);
    expect(result.tasksStateCreated).toBe(true);
    expect(result.gitignoreUpdated).toBe(true);
    await expect(readFile(path.join(projectPath, ".codex/state/tasks.json"), "utf8")).resolves.toContain('"tasks": []');
    await expect(readFile(path.join(projectPath, ".codex/README.md"), "utf8")).resolves.toContain("Local Codex Workflow");
    await expect(readFile(path.join(projectPath, ".gitignore"), "utf8")).resolves.toContain(".codex/");
  });

  it("can run bootstrap repeatedly without overwriting existing .codex files", async () => {
    const projectPath = await tempProject();
    await initGit(projectPath);
    const bootstrap = new ProjectBootstrap();
    await bootstrap.bootstrap(projectPath);
    await writeFile(path.join(projectPath, ".codex/reports/keep.md"), "keep me", "utf8");

    const second = await bootstrap.bootstrap(projectPath);

    expect(second.codexCreated).toBe(false);
    expect(second.gitignoreUpdated).toBe(false);
    await expect(readFile(path.join(projectPath, ".codex/reports/keep.md"), "utf8")).resolves.toBe("keep me");
  });

  it("reports health for a ready project", async () => {
    const projectPath = await tempProject();
    await writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "vitest run", lint: "eslint ." } }, null, 2),
      "utf8"
    );
    await writeFile(path.join(projectPath, "package-lock.json"), "{}", "utf8");
    await initGit(projectPath);
    await new ProjectBootstrap().bootstrap(projectPath);
    await safeExec(projectPath, "git add .gitignore package.json package-lock.json");
    await safeExec(projectPath, "git commit -m ready");

    const health = await new ProjectHealthService().check(projectPath);

    expect(health.ready).toBe(true);
    expect(health.packageManager).toBe("npm");
    expect(health.availableChecks).toEqual(["npm run build", "npm test", "npm run lint"]);
  });

  it("reports warnings for a folder without Git", async () => {
    const projectPath = await tempProject();

    const health = await new ProjectHealthService().check(projectPath);

    expect(health.ready).toBe(false);
    expect(health.isGitRepo).toBe(false);
    expect(health.warnings).toContain("Project is not a Git repository.");
  });
});

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function initGit(projectPath: string): Promise<void> {
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
}
