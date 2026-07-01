import { describe, expect, it } from "vitest";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TaskStore } from "../src/services/taskStore.js";

describe("TaskStore", () => {
  it("creates the .codex structure", async () => {
    const projectPath = await tempProject();
    await new TaskStore().ensureStructure(projectPath);

    await expect(readFile(path.join(projectPath, ".codex/state/tasks.json"), "utf8")).resolves.toContain('"tasks": []');
  });

  it("creates tasks and increments ids", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();

    const first = await store.createTask(projectPath, taskInput("One"));
    const second = await store.createTask(projectPath, taskInput("Two"));
    const third = await store.createTask(projectPath, taskInput("Three"));

    expect([first.id, second.id, third.id]).toEqual(["0001", "0002", "0003"]);
    await expect(readFile(path.join(projectPath, ".codex/tasks/0001-task.md"), "utf8")).resolves.toContain("# Task 0001: One");
  });

  it("allocates the next id after existing task and report artifacts", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.ensureStructure(projectPath);
    await writeFile(path.join(projectPath, ".codex/reports/0016-report.md"), "# Report for Task 0016\n", "utf8");
    await writeFile(path.join(projectPath, ".codex/reports/0014-review.md"), "# Review Gate for Task 0014\n\n## Decision\n\nAPPROVABLE\n", "utf8");
    await writeFile(path.join(projectPath, ".codex/tasks/0015-fix.md"), "# Fix request for Task 0015\n", "utf8");

    const task = await store.createTask(projectPath, taskInput("After artifacts"));

    expect(task.id).toBe("0017");
    expect(task.taskPath).toBe(".codex/tasks/0017-task.md");
    expect(task.reportPath).toBe(".codex/reports/0017-report.md");
  });

  it("reads reports and updates status in state and markdown", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Reportable"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 0001\n", "utf8");

    await expect(store.readReport(projectPath, "0001")).resolves.toMatchObject({ taskId: "0001" });
    const updated = await store.updateStatus(projectPath, "0001", "reported");
    const taskMarkdown = await readFile(path.join(projectPath, ".codex/tasks/0001-task.md"), "utf8");
    const state = await store.readState(projectPath);

    expect(updated.status).toBe("reported");
    expect(taskMarkdown).toContain("## Status\n\nreported");
    expect(state.tasks[0]?.status).toBe("reported");
  });

  it("reads a task report saved with UTF-8 BOM", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("BOM report"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "\uFEFF# Report for Task 0001\n\nSaved from PowerShell.\n", "utf8");

    await expect(store.readReport(projectPath, "0001")).resolves.toMatchObject({ taskId: "0001" });
  });

  it("syncs pending tasks to reported when a report file exists", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Sync me"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 0001\n", "utf8");

    const synced = await store.syncReportedTasks(projectPath);
    const taskMarkdown = await readFile(path.join(projectPath, ".codex/tasks/0001-task.md"), "utf8");

    expect(synced[0]?.status).toBe("reported");
    expect(taskMarkdown).toContain("## Status\n\nreported");
  });

  it("syncs a pending task to reported when the report uses UTF-8 BOM", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("BOM sync"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "\uFEFF# Report for Task 0001\n\nSaved from PowerShell.\n", "utf8");

    const synced = await store.syncReportedTasks(projectPath);

    expect(synced[0]?.status).toBe("reported");
  });

  it("syncs report-backed state even when task markdown is missing", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Missing markdown"));
    await unlink(path.join(projectPath, ".codex/tasks/0001-task.md"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 0001\n", "utf8");

    const synced = await store.syncReportedTasks(projectPath);
    const state = await store.readState(projectPath);

    expect(synced[0]?.status).toBe("reported");
    expect(state.tasks[0]?.status).toBe("reported");
  });

  it("does not sync a pending task to reported when a colliding report belongs to another task", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Collision"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 9999\n\nHistorical report.\n", "utf8");

    const synced = await store.syncReportedTasks(projectPath);
    const taskMarkdown = await readFile(path.join(projectPath, ".codex/tasks/0001-task.md"), "utf8");

    expect(synced[0]?.status).toBe("pending");
    expect(taskMarkdown).toContain("## Status\n\npending");
  });

  it("rejects reading a colliding report that belongs to another task", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Read collision"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 9999\n\nHistorical report.\n", "utf8");

    await expect(store.readReport(projectPath, "0001")).rejects.toThrow("Report content does not belong to task 0001");
  });

  it("approves and rejects tasks with decision records", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Review me"));

    await store.approveTask(projectPath, "0001", "Accepted.");
    expect((await store.getTask(projectPath, "0001")).status).toBe("approved");
    await expect(readFile(path.join(projectPath, ".codex/decisions/0001-approval.md"), "utf8")).resolves.toContain("Accepted.");

    await store.rejectTask(projectPath, "0001", "Needs changes.", ["Fix tests"]);
    expect((await store.getTask(projectPath, "0001")).status).toBe("rejected");
    await expect(readFile(path.join(projectPath, ".codex/tasks/0001-fix.md"), "utf8")).resolves.toContain("Fix tests");
  }, 15000);

  it("lists tasks and archives approved tasks", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Archive me"));
    await writeFile(path.join(projectPath, ".codex/reports/0001-report.md"), "# Report for Task 0001\n", "utf8");
    await store.approveTask(projectPath, "0001", "Accepted.");

    await expect(store.listTasks(projectPath, "approved")).resolves.toHaveLength(1);
    const archived = await store.archiveTask(projectPath, "0001", "Task completed and committed.");

    expect(archived.status).toBe("archived");
    expect(archived.taskPath).toBe(".codex/archive/0001/0001-task.md");
    await expect(readFile(path.join(projectPath, ".codex/archive/0001/0001-task.md"), "utf8")).resolves.toContain("archived");
    await expect(readFile(path.join(projectPath, ".codex/archive/0001/0001-report.md"), "utf8")).resolves.toContain("Report");
    await expect(readFile(path.join(projectPath, ".codex/decisions/0001-archive.md"), "utf8")).resolves.toContain(
      "Task completed and committed."
    );
  });

  it("does not archive pending tasks", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Still pending"));

    await expect(store.archiveTask(projectPath, "0001", "Too early.")).rejects.toThrow("Only approved or rejected tasks");
    await expect(stat(path.join(projectPath, ".codex/tasks/0001-task.md"))).resolves.toBeDefined();
  });

  it("recreates a missing task markdown from state before updating status", async () => {
    const projectPath = await tempProject();
    const store = new TaskStore();
    await store.createTask(projectPath, taskInput("Recover me"));
    await unlink(path.join(projectPath, ".codex/tasks/0001-task.md"));

    const updated = await store.updateStatus(projectPath, "0001", "approved");
    const recovered = await readFile(path.join(projectPath, ".codex/tasks/0001-task.md"), "utf8");

    expect(updated.status).toBe("approved");
    expect(recovered).toContain("# Task 0001: Recover me");
    expect(recovered).toContain("Recovered from .codex/state/tasks.json");
    expect(recovered).toContain("## Status\n\napproved");
  });
});

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

function taskInput(title: string) {
  return {
    title,
    goal: "Goal",
    context: "Context",
    scope: ["Do the thing"],
    outOfScope: ["Avoid extra work"],
    filesAllowed: ["src/**"],
    acceptanceCriteria: ["It works"],
    requiredChecks: ["npm test"],
    notes: "Be careful."
  };
}
