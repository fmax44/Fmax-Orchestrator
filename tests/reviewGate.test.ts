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

  it("stores lastReviewGate provenance when writeReport is used", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);

    const result = await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });
    const state = await new TaskStore().readState(projectPath);
    const task = state.tasks.find((item) => item.id === taskId);

    expect(result.reviewHash).toMatch(/^sha256:/);
    expect(task?.lastReviewGate?.reviewHash).toBe(result.reviewHash);
    expect(task?.lastReviewGate?.reviewReportPath).toBe(`.codex/reports/${taskId}-review.md`);
  });
});

describe("approve_task Review Gate integration", () => {
  it("allows approval when Review Gate is APPROVABLE", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);
    await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });

    const result = (await createToolHandlers().approveTask({
      projectPath,
      taskId,
      decision: "Approved."
    })) as { status: string; reviewGate: { decision: string } };

    expect(result.status).toBe("approved");
    expect(result.reviewGate.decision).toBe("APPROVABLE");
  });

  it("requires override when Review Gate is NEEDS_REVIEW", async () => {
    const projectPath = await readyProject("docker-compose");
    const taskId = await docsTaskWithReport(projectPath);
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services: {}\n", "utf8");
    await safeExec(projectPath, "git add docker-compose.yml");
    await safeExec(projectPath, "git commit -m compose");
    await writeFile(path.join(projectPath, "docker-compose.yml"), "services:\n  app:\n    image: busybox\n", "utf8");
    await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/requires.*review|overrideReviewGate/i);

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved with override.",
        overrideReviewGate: true
      })
    ).resolves.toMatchObject({ status: "approved" });
  });

  it("blocks approval when Review Gate is BLOCKED", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/writeReport: true/);
  });

  it("force approval requires forceReason", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);

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
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);

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

  it("blocks approval when review is stale", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);
    await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });
    const state = await new TaskStore().readState(projectPath);
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task?.lastReviewGate) {
      throw new Error("Missing lastReviewGate");
    }
    task.lastReviewGate.createdAt = "2000-01-01T00:00:00.000Z";
    await writeFile(path.join(projectPath, ".codex", "state", "tasks.json"), `${JSON.stringify(state, null, 2)}\n`, "utf8");

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/stale|overrideReviewGate/i);
  });

  it("blocks approval when review hash mismatches", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);
    await new ReviewGateService().run({
      projectPath,
      taskId,
      checks: ["git status --short"],
      writeReport: true
    });
    await writeFile(path.join(projectPath, ".codex", "reports", `${taskId}-review.md`), "tampered", "utf8");

    await expect(
      createToolHandlers().approveTask({
        projectPath,
        taskId,
        decision: "Approved."
      })
    ).rejects.toThrow(/hash does not match/);
  });

  it("CLI approve works on the happy path", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);
    await execaCommand(`npm run review -- --project "${projectPath}" --task ${taskId} --checks "git status --short" --write-report --format json`, {
      cwd: process.cwd(),
      shell: true
    });

    const result = await execaCommand(
      `npm run approve -- --project "${projectPath}" --task ${taskId} --decision "Approved after strict review"`,
      {
        cwd: process.cwd(),
        shell: true
      }
    );

    expect(result.stdout).toContain('"status": "approved"');
    expect(result.stdout).toContain('"decision": "APPROVABLE"');
  });

  it("CLI approve is blocked without review provenance", async () => {
    const projectPath = await readyProject("node");
    const taskId = await docsTaskWithReport(projectPath);

    await expect(
      execaCommand(`npm run approve -- --project "${projectPath}" --task ${taskId} --decision "Approved after strict review"`, {
        cwd: process.cwd(),
        shell: true
      })
    ).rejects.toThrow();
  });
});

async function readyProject(policy: "basic" | "node" | "docker-compose"): Promise<string> {
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
