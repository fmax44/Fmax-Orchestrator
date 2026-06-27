import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execaCommand } from "execa";
import { DoctorService } from "../src/services/doctor.js";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { SmokeRunner } from "../src/services/smokeRunner.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("DoctorService", () => {
  it("runs doctor without a target project", async () => {
    const result = await new DoctorService().run();

    expect(result.result).not.toBe("NOT_READY");
    expect(result.orchestrator.checks.some((check) => check.name === "MCP tools registered" && check.status === "pass")).toBe(true);
  });

  it("runs doctor with a ready project", async () => {
    const projectPath = await readyProject();

    const result = await new DoctorService().run(projectPath);

    expect(result.result).toBe("READY_WITH_WARNINGS");
    expect(result.targetProject?.checks.some((check) => check.name === "git repository detected" && check.status === "pass")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("npm run lint is not available"))).toBe(true);
  });

  it("reports NOT_READY for a target folder without Git", async () => {
    const projectPath = await tempProject();

    const result = await new DoctorService().run(projectPath);

    expect(result.result).toBe("NOT_READY");
    expect(result.errors.some((error) => error.includes("git repository detected"))).toBe(true);
  });

  it("is JSON serializable", async () => {
    const result = await new DoctorService().run();
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

    expect(parsed.orchestrator.checks.length).toBeGreaterThan(0);
  });

  it("detects forbidden tracked paths", async () => {
    const projectPath = await tempProject();
    await initGit(projectPath);
    await writeFile(path.join(projectPath, ".env"), "SECRET=value", "utf8");
    await execaCommand("git add .env", { cwd: projectPath, shell: true });

    const forbidden = await new DoctorService().forbiddenTrackedPaths(projectPath);

    expect(forbidden).toEqual([".env"]);
  });
});

describe("SmokeRunner", () => {
  it("runs smoke on a ready project and keeps tracked files clean", async () => {
    const projectPath = await readyProject();

    const result = await new SmokeRunner().run(projectPath);
    const gitStatus = await safeExec(projectPath, "git status --short");

    expect(result.result).toBe("PASS");
    expect(result.reportPath).toMatch(/^\.codex\/reports\/smoke-report-/);
    expect(gitStatus.stdout.trim()).toBe("");
  });

  it("creates a smoke report", async () => {
    const projectPath = await readyProject();

    const result = await new SmokeRunner().run(projectPath);
    const report = await readFile(path.join(projectPath, result.reportPath ?? ""), "utf8");

    expect(report).toContain("# Smoke Report");
  });

  it("is JSON serializable", async () => {
    const projectPath = await readyProject();
    const result = await new SmokeRunner().run(projectPath);
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

    expect(parsed.result).toBe("PASS");
    expect(parsed.checks.some((check) => check.name === "git_status_clean")).toBe(true);
  });
});

async function readyProject(): Promise<string> {
  const projectPath = await tempProject();
  await writeFile(
    path.join(projectPath, "package.json"),
    JSON.stringify({ scripts: { build: "tsc -v", test: "node -e \"console.log('test')\"" } }, null, 2),
    "utf8"
  );
  await writeFile(path.join(projectPath, "package-lock.json"), "{}", "utf8");
  await initGit(projectPath);
  await new ProjectBootstrap().bootstrap(projectPath);
  await safeExec(projectPath, "git add .gitignore package.json package-lock.json");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

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
