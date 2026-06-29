import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execaCommand } from "execa";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { ReviewGateService } from "../src/services/reviewGate.js";
import { TaskStore } from "../src/services/taskStore.js";
import { createToolHandlers } from "../src/mcp/tools.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("ReviewGateService", () => {
  it("returns APPROVABLE for a docs-only diff", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await createIntentToAdd(projectPath, "docs/guide.md", "hello");

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"]
    });

    expect(result.decision).toBe("APPROVABLE");
    expect(result.recommendedAction).toBe("approve_task");
    expect(result.changedFiles).toEqual(["docs/guide.md"]);
  });

  it("returns BLOCKED when .env changes", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await writeFile(path.join(projectPath, ".env"), "SECRET=old", "utf8");
    await execaCommand("git add .env", { cwd: projectPath, shell: true });
    await execaCommand("git commit -m env", { cwd: projectPath, shell: true });
    await writeFile(path.join(projectPath, ".env"), "SECRET=new", "utf8");

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"]
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.errors.some((error) => error.includes("blocked"))).toBe(true);
  });

  it("returns BLOCKED when .codex is tracked", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await writeFile(path.join(projectPath, ".codex", "tracked.md"), "old", "utf8");
    await execaCommand("git add -f .codex/tracked.md", { cwd: projectPath, shell: true });
    await execaCommand("git commit -m codex-tracked", { cwd: projectPath, shell: true });
    await writeFile(path.join(projectPath, ".codex", "tracked.md"), "new", "utf8");

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"]
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.errors.some((error) => error.includes("Forbidden paths are tracked") || error.includes("blocked"))).toBe(true);
  });

  it("returns NEEDS_REVIEW for a protected file", async () => {
    const projectPath = await readyProject("docker-compose");
    const taskId = await docsTaskWithReport(projectPath);
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services: {}\n", "utf8");
    await safeExec(projectPath, "git add docker-compose.yml");
    await safeExec(projectPath, "git commit -m compose");
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services:\n  app:\n    image: busybox\n", "utf8");

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"]
    });

    expect(result.decision).toBe("NEEDS_REVIEW");
    expect(result.manualApprovalRequired).toBe(true);
  });

  it("returns BLOCKED when report is missing", async () => {
    const projectPath = await readyProject("basic");
    const task = await new TaskStore().createTask(projectPath, {
      title: "Docs",
      goal: "Update docs",
      filesAllowed: ["docs/guide.md"],
      requiredChecks: ["git status --short"]
    });

    const result = await new ReviewGateService().run({
      projectPath,
      taskId: task.id,
      checks: ["git status --short"]
    });

    expect(result.decision).toBe("BLOCKED");
    expect(result.errors).toContain("Report is required but missing.");
  });

  it("is JSON serializable", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);

    const result = await new ReviewGateService().run({ projectPath, taskId, checks: ["git status --short"] });
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result;

    expect(parsed.taskId).toBe(taskId);
    expect(parsed.checks.length).toBeGreaterThan(0);
  });

  it("writes a review report", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });
    const report = await readFile(path.join(projectPath, result.reviewReportPath ?? ""), "utf8");

    expect(result.reviewReportPath).toBe(`.codex/reports/${taskId}-review.md`);
    expect(report).toContain(`# Review Gate for Task ${taskId}`);
  });
});

describe("approve_task Review Gate integration", () => {
  it("allows approval when Review Gate is APPROVABLE", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);

    const result = (await createToolHandlers().approveTask({
      projectPath,
      taskId,
      decision: "Approved."
    })) as { task: { status: string }; reviewGate: { decision: string } };

    expect(result.task.status).toBe("approved");
    expect(result.reviewGate.decision).toBe("APPROVABLE");
  });

  it("requires override when Review Gate is NEEDS_REVIEW", async () => {
    const projectPath = await readyProject("docker-compose");
    const taskId = await docsTaskWithReport(projectPath);
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services: {}\n", "utf8");
    await safeExec(projectPath, "git add docker-compose.yml");
    await safeExec(projectPath, "git commit -m compose");
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services:\n  app:\n    image: busybox\n", "utf8");

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/requires manual review/);

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved with override.",
        overrideReviewGate: true
      })
    ).resolves.toMatchObject({ task: { status: "approved" } });
  });

  it("blocks approval when Review Gate is BLOCKED", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await mkdir(path.join(projectPath, "dist"), { recursive: true });
    await writeFile(path.join(projectPath, "dist", "app.js"), "old", "utf8");
    await safeExec(projectPath, "git add dist/app.js");
    await safeExec(projectPath, "git commit -m dist");
    await writeFile(path.join(projectPath, "dist", "app.js"), "new", "utf8");

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/blocked approval/);
  });

  it("force approval requires forceReason", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await mkdir(path.join(projectPath, "dist"), { recursive: true });
    await writeFile(path.join(projectPath, "dist", "app.js"), "old", "utf8");
    await safeExec(projectPath, "git add dist/app.js");
    await safeExec(projectPath, "git commit -m dist");
    await writeFile(path.join(projectPath, "dist", "app.js"), "new", "utf8");

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved.",
        force: true
      })
    ).rejects.toThrow(/forceReason is required/);
  });

  it("force approval writes decision log", async () => {
    const projectPath = await readyProject("basic");
    const taskId = await docsTaskWithReport(projectPath);
    await mkdir(path.join(projectPath, "dist"), { recursive: true });
    await writeFile(path.join(projectPath, "dist", "app.js"), "old", "utf8");
    await safeExec(projectPath, "git add dist/app.js");
    await safeExec(projectPath, "git commit -m dist");
    await writeFile(path.join(projectPath, "dist", "app.js"), "new", "utf8");

    await createToolHandlers().approveTask({
      projectPath,
      taskId,
      decision: "Force approved.",
      force: true,
      forceReason: "Emergency documented exception."
    });
    const decisionLog = await readFile(path.join(projectPath, ".codex", "decisions", "architect-log.md"), "utf8");

    expect(decisionLog).toContain("FORCE APPROVAL REASON");
    expect(decisionLog).toContain("Emergency documented exception.");
  });
});

async function readyProject(policy: "basic" | "docker-compose"): Promise<string> {
  const projectPath = path.join(os.tmpdir(), `chatgpt-codex-mcp-review-${crypto.randomUUID()}`);
  await mkdir(projectPath, { recursive: true });
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(projectPath, { policy });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function docsTaskWithReport(projectPath: string): Promise<string> {
  const task = await new TaskStore().createTask(projectPath, {
    title: "Docs",
    goal: "Update docs",
    filesAllowed: ["docs/guide.md"],
    requiredChecks: ["git status --short"]
  });
  await writeFile(path.join(projectPath, ".codex", "reports", `${task.id}-report.md`), `# Report for Task ${task.id}\n\nDocs updated.\n`, "utf8");
  return task.id;
}

async function createIntentToAdd(projectPath: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(projectPath, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  await safeExec(projectPath, `git add -N ${relativePath}`);
}
