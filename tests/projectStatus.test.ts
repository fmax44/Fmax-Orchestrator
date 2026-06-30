import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execaCommand } from "execa";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { ProjectStatusService } from "../src/services/projectStatus.js";
import { ReviewGateService } from "../src/services/reviewGate.js";
import { TaskStore } from "../src/services/taskStore.js";
import { createToolHandlers, toolNames } from "../src/mcp/tools.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("ProjectStatusService", () => {
  it("recommends create_task for a project without tasks", async () => {
    const projectPath = await readyProject();

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.tasks.total).toBe(0);
    expect(status.recommendedAction).toBe("create_task");
    expect(status.git.status).toBe("clean");
    expect(status.policy.strictReviewGate).toBe(true);
  }, 15000);

  it("recommends waiting for a pending task without report", async () => {
    const projectPath = await readyProject();
    await createTask(projectPath);

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.tasks.pending).toBe(1);
    expect(status.recommendedAction).toBe("wait_for_codex_or_request_report");
    expect(status.waitingFor).toBe("codex");
    expect(status.nextActor).toBe("codex");
    expect(status.nextAction).toContain("Open Codex Desktop");
  }, 15000);

  it("recommends running Review Gate when a report exists without review", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.reports.latestTaskReport).toBe(`.codex/reports/${taskId}-report.md`);
    expect(status.review?.exists).toBe(false);
    expect(status.currentTask?.status).toBe("reported");
    expect(status.recommendedAction).toBe("run_review_gate");
    expect(status.waitingFor).toBe("review");
    expect(status.nextActor).toBe("chatgpt");
  }, 15000);

  it("recommends approval when Review Gate is APPROVABLE", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);
    await runReview(projectPath, taskId);

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.review?.latestDecision).toBe("APPROVABLE");
    expect(status.review?.lastReviewHash).toMatch(/^sha256:/);
    expect(status.recommendedAction).toBe("approve_task");
  }, 15000);

  it("recommends committing changes for an approved task with dirty git", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);
    await new TaskStore().updateStatus(projectPath, taskId, "approved");
    await mkdir(path.join(projectPath, "docs"), { recursive: true });
    await writeFile(path.join(projectPath, "docs", "change.md"), "dirty", "utf8");

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.git.status).toBe("dirty");
    expect(status.recommendedAction).toBe("commit_changes");
  }, 15000);

  it("recommends creating the next task for an approved task with clean git", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);
    await new TaskStore().updateStatus(projectPath, taskId, "approved");

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.git.status).toBe("clean");
    expect(status.recommendedAction).toBe("create_next_task");
  }, 15000);

  it("detects stale review provenance", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);
    await runReview(projectPath, taskId);
    const statePath = path.join(projectPath, ".codex", "state", "tasks.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as { tasks: Array<{ id: string; lastReviewGate?: { createdAt: string } }> };
    const task = state.tasks.find((item) => item.id === taskId);
    if (!task?.lastReviewGate) {
      throw new Error("Missing review provenance");
    }
    task.lastReviewGate.createdAt = "2000-01-01T00:00:00.000Z";
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const status = await new ProjectStatusService().check({ projectPath, includeDoctor: false });

    expect(status.review?.expired).toBe(true);
    expect(status.recommendedAction).toBe("rerun_review_gate");
  }, 15000);

  it("supports JSON output through the CLI", async () => {
    const projectPath = await readyProject();

    const result = await execaCommand(`npm run status -- --project "${projectPath}" --format json --no-doctor`, {
      cwd: process.cwd(),
      shell: true
    });
    const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as { recommendedAction: string; projectName: string };

    expect(parsed.projectName).toBe(path.basename(projectPath));
    expect(parsed.recommendedAction).toBe("create_task");
  }, 15000);

  it("registers and serves MCP project_status", async () => {
    const projectPath = await readyProject();

    expect(toolNames).toContain("project_status");
    await expect(createToolHandlers().projectStatus({ projectPath, includeDoctor: false })).resolves.toMatchObject({
      recommendedAction: "create_task",
      tasks: { total: 0 },
      waitingFor: "chatgpt",
      nextActor: "chatgpt"
    });
  }, 15000);

  it("serves MCP relay_status and codex_next for a pending task", async () => {
    const projectPath = await readyProject();
    await createTask(projectPath);
    const handlers = createToolHandlers();

    await expect(handlers.relayStatus({ projectPath, includeDoctor: false })).resolves.toMatchObject({
      waitingFor: "codex",
      nextActor: "codex",
      currentTask: {
        id: "0001",
        status: "pending"
      }
    });

    await expect(handlers.codexNext({ projectPath })).resolves.toMatchObject({
      waitingFor: "codex",
      task: {
        id: "0001",
        status: "pending"
      }
    });
  }, 15000);
});

async function readyProject(): Promise<string> {
  const projectPath = path.join(os.tmpdir(), `chatgpt-codex-mcp-status-${crypto.randomUUID()}`);
  await mkdir(projectPath, { recursive: true });
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(projectPath, { policy: "node" });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function createTask(projectPath: string): Promise<string> {
  const task = await new TaskStore().createTask(projectPath, {
    title: "Status task",
    goal: "Exercise status",
    filesAllowed: ["docs/guide.md"],
    requiredChecks: ["git status --short"]
  });
  return task.id;
}

async function writeReport(projectPath: string, taskId: string): Promise<void> {
  await writeFile(path.join(projectPath, ".codex", "reports", `${taskId}-report.md`), `# Report for Task ${taskId}\n\nStatus test report.\n`, "utf8");
}

async function runReview(projectPath: string, taskId: string): Promise<void> {
  await new ReviewGateService().run({
    projectPath,
    taskId,
    checks: ["git status --short"],
    writeReport: true
  });
}
