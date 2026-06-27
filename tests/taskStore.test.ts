import { describe, expect, it } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
