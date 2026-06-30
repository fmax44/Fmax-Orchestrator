import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { ProjectPolicyService } from "../src/services/projectPolicy.js";
import { TaskStore } from "../src/services/taskStore.js";
import { DoctorService } from "../src/services/doctor.js";
import { SmokeRunner } from "../src/services/smokeRunner.js";
import { createToolHandlers } from "../src/mcp/tools.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("ProjectPolicyService", () => {
  it("creates a basic policy", async () => {
    const projectPath = await gitProject();

    const result = await new ProjectBootstrap().bootstrap(projectPath, { policy: "basic" });

    expect(result.policy?.created).toBe(true);
    expect(result.policy?.policy.defaultProfile).toBe("default");
    expect(result.policy?.policy.workflow.strictReviewGate).toBe(false);
  }, 15000);

  it("creates a node policy", async () => {
    const projectPath = await gitProject();

    const result = await new ProjectBootstrap().bootstrap(projectPath, { policy: "node" });

    expect(result.policy?.policy.allowedCommands).toContain("npm run build");
    expect(result.policy?.policy.requiredChecks.node).toContain("npm test");
    expect(result.policy?.policy.workflow.strictReviewGate).toBe(true);
  }, 15000);

  it("creates a docker-compose policy", async () => {
    const projectPath = await gitProject();

    const result = await new ProjectBootstrap().bootstrap(projectPath, { policy: "docker-compose" });

    expect(result.policy?.policy.defaultProfile).toBe("docker-compose");
    expect(result.policy?.policy.blockedCommands).toContain("docker compose config");
    expect(result.policy?.policy.workflow.strictReviewGate).toBe(true);
  }, 15000);

  it("does not overwrite an existing policy without force", async () => {
    const projectPath = await gitProject();
    const bootstrap = new ProjectBootstrap();
    await bootstrap.bootstrap(projectPath, { policy: "basic" });
    await writeFile(path.join(projectPath, ".codex", "project-policy.json"), JSON.stringify({ version: 1, projectName: "custom" }, null, 2), "utf8");

    const result = await bootstrap.bootstrap(projectPath, { policy: "node" });

    expect(result.policy?.created).toBe(false);
    expect(result.policy?.overwritten).toBe(false);
    expect(result.policy?.policy.projectName).toBe("custom");
  }, 15000);

  it("overwrites an existing policy with force", async () => {
    const projectPath = await gitProject();
    const bootstrap = new ProjectBootstrap();
    await bootstrap.bootstrap(projectPath, { policy: "basic" });

    const result = await bootstrap.bootstrap(projectPath, { policy: "node", forcePolicy: true });

    expect(result.policy?.overwritten).toBe(true);
    expect(result.policy?.policy.allowedCommands).toContain("npm run lint");
  }, 15000);

  it("reads policy", async () => {
    const projectPath = await readyProject("basic");

    const result = await new ProjectPolicyService().readPolicy(projectPath);

    expect(result.exists).toBe(true);
    expect(result.policy?.version).toBe(1);
  }, 15000);

  it("validates a valid task", async () => {
    const projectPath = await readyProject("basic");
    const task = await new TaskStore().createTask(projectPath, {
      title: "Docs task",
      goal: "Update docs",
      filesAllowed: ["docs/guide.md"],
      requiredChecks: ["git status --short"]
    });

    const result = await new ProjectPolicyService().validateTaskAgainstPolicy(projectPath, task.id);

    expect(result.valid).toBe(true);
    expect(result.manualApprovalRequired).toBe(false);
  }, 15000);

  it("rejects a task with a blocked path", async () => {
    const projectPath = await readyProject("basic");
    const task = await new TaskStore().createTask(projectPath, {
      title: "Bad task",
      goal: "Update env",
      filesAllowed: [".env"],
      requiredChecks: ["git status --short"]
    });

    const result = await new ProjectPolicyService().validateTaskAgainstPolicy(projectPath, task.id);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("blocked path"))).toBe(true);
  }, 15000);

  it("flags a task with a protected file", async () => {
    const projectPath = await readyProject("docker-compose");
    const task = await new TaskStore().createTask(projectPath, {
      title: "Compose task",
      goal: "Review compose",
      filesAllowed: ["docker-compose.yml"],
      requiredChecks: ["git status --short"]
    });

    const result = await new ProjectPolicyService().validateTaskAgainstPolicy(projectPath, task.id);

    expect(result.valid).toBe(true);
    expect(result.manualApprovalRequired).toBe(true);
  }, 15000);

  it("rejects a task with a blocked command", async () => {
    const projectPath = await readyProject("docker-compose");
    const task = await new TaskStore().createTask(projectPath, {
      title: "Bad command",
      goal: "Check compose config",
      filesAllowed: ["docs/guide.md"],
      requiredChecks: ["docker compose config"]
    });

    const result = await new ProjectPolicyService().validateTaskAgainstPolicy(projectPath, task.id);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("blocked command"))).toBe(true);
  }, 15000);

  it("validates a docs-only diff", async () => {
    const projectPath = await readyProject("basic");
    await mkdir(path.join(projectPath, "docs"), { recursive: true });
    await writeFile(path.join(projectPath, "docs", "guide.md"), "old", "utf8");
    await safeExec(projectPath, "git add docs/guide.md");
    await safeExec(projectPath, "git commit -m docs");
    await writeFile(path.join(projectPath, "docs", "guide.md"), "new", "utf8");

    const result = await new ProjectPolicyService().validateDiffAgainstPolicy(projectPath);

    expect(result.valid).toBe(true);
    expect(result.changedFiles).toEqual(["docs/guide.md"]);
  }, 15000);

  it("rejects a diff with a blocked path", async () => {
    const projectPath = await readyProject("basic");
    await mkdir(path.join(projectPath, "dist"), { recursive: true });
    await writeFile(path.join(projectPath, "dist", "app.js"), "old", "utf8");
    await safeExec(projectPath, "git add dist/app.js");
    await safeExec(projectPath, "git commit -m dist");
    await writeFile(path.join(projectPath, "dist", "app.js"), "new", "utf8");

    const result = await new ProjectPolicyService().validateDiffAgainstPolicy(projectPath);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("blocked"))).toBe(true);
  }, 15000);

  it("shows policy in doctor", async () => {
    const projectPath = await readyProject("basic");

    const result = await new DoctorService().run({ projectPath });

    expect(result.profile).toBe("default");
    expect(result.targetProject?.checks.some((check) => check.name === "policy exists" && check.status === "pass")).toBe(true);
  }, 15000);

  it("uses default ephemeral smoke mode from policy", async () => {
    const projectPath = await readyProject("basic");

    const result = await new SmokeRunner().run(projectPath);

    expect(result.result).toBe("PASS");
    expect(result.ephemeral).toBe(true);
    expect(result.reportPath).toMatch(/^\.codex\/smoke\/reports\//);
  }, 15000);

  it("adds Policy Notes when create_task uses policy", async () => {
    const projectPath = await readyProject("basic");
    const handlers = createToolHandlers();

    const result = (await handlers.createTask({
      projectPath,
      title: "Docs",
      goal: "Update docs",
      filesAllowed: ["docs/guide.md"],
      requiredChecks: ["git status --short"],
      acceptanceCriteria: ["Docs updated"]
    })) as { taskId: string };
    const taskMarkdown = await readFile(path.join(projectPath, ".codex", "tasks", `${result.taskId}-task.md`), "utf8");

    expect(taskMarkdown).toContain("## Policy Notes");
    expect(taskMarkdown).toContain("Policy file: .codex/project-policy.json");
    expect(taskMarkdown).toContain("Manual approval required: no");
  }, 15000);
});

async function readyProject(policy: "basic" | "node" | "docker-compose"): Promise<string> {
  const projectPath = await gitProject();
  await new ProjectBootstrap().bootstrap(projectPath, { policy });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function gitProject(): Promise<string> {
  const projectPath = path.join(os.tmpdir(), `chatgpt-codex-mcp-policy-${crypto.randomUUID()}`);
  await mkdir(projectPath, { recursive: true });
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  return projectPath;
}
