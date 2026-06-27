import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CreateTaskData, TaskRecord, TaskState } from "../domain/task.js";
import type { TaskReport } from "../domain/report.js";
import type { TaskStatus } from "../domain/status.js";
import { isTaskStatus } from "../domain/status.js";
import { checklist, markdownList, replaceMarkdownSection } from "../utils/markdown.js";
import { ensureCodexStructure, ensureRelativeInsideProject, toProjectRelative } from "../utils/paths.js";
import { ArchitectLog } from "./architectLog.js";

const emptyState: TaskState = { tasks: [] };

export class TaskStore {
  constructor(private readonly architectLog = new ArchitectLog()) {}

  async ensureStructure(projectPath: string): Promise<void> {
    const paths = await ensureCodexStructure(projectPath);
    const existing = await this.readStateFile(paths.tasksStatePath).catch(() => undefined);

    if (!existing) {
      await this.writeStateFile(paths.tasksStatePath, emptyState);
    }
  }

  async createTask(projectPath: string, input: CreateTaskData): Promise<TaskRecord> {
    const paths = await ensureCodexStructure(projectPath);
    const state = await this.readState(projectPath);
    const id = this.nextTaskId(state.tasks);
    const now = new Date().toISOString();
    const taskPath = path.join(paths.tasksDir, `${id}-task.md`);
    const reportPath = path.join(paths.reportsDir, `${id}-report.md`);
    const record: TaskRecord = {
      id,
      title: input.title,
      status: "pending",
      taskPath: toProjectRelative(paths.root, taskPath),
      reportPath: toProjectRelative(paths.root, reportPath),
      createdAt: now,
      updatedAt: now
    };

    await writeFile(taskPath, this.renderTaskMarkdown(record, input), "utf8");
    await this.writeState(projectPath, { tasks: [...state.tasks, record] });
    await this.architectLog.record(projectPath, {
      taskId: id,
      type: "create-task",
      title: `Task ${id} created`,
      body: `Created task "${input.title}" with status pending.`
    });

    return record;
  }

  async createNextTask(
    projectPath: string,
    previousTaskId: string,
    input: Omit<CreateTaskData, "context"> & { context?: string }
  ): Promise<TaskRecord> {
    const previousTask = await this.getTask(projectPath, previousTaskId);
    const previousReport = await this.readReport(projectPath, previousTaskId).catch(() => undefined);
    const context = [
      input.context,
      `Previous task: ${previousTask.taskPath}`,
      `Previous report: ${previousTask.reportPath}`,
      previousReport ? `Previous report summary:\n\n${previousReport.markdown.slice(0, 2_000)}` : "Previous report is not available."
    ]
      .filter(Boolean)
      .join("\n\n");

    return this.createTask(projectPath, { ...input, context });
  }

  async readState(projectPath: string): Promise<TaskState> {
    const paths = await ensureCodexStructure(projectPath);
    return this.readStateFile(paths.tasksStatePath).catch(async (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        await this.writeStateFile(paths.tasksStatePath, emptyState);
        return emptyState;
      }

      throw error;
    });
  }

  async getTask(projectPath: string, taskId: string): Promise<TaskRecord> {
    const state = await this.readState(projectPath);
    const task = state.tasks.find((item) => item.id === taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return task;
  }

  async updateStatus(projectPath: string, taskId: string, status: TaskStatus): Promise<TaskRecord> {
    const paths = await ensureCodexStructure(projectPath);
    const state = await this.readState(projectPath);
    const index = state.tasks.findIndex((task) => task.id === taskId);

    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const current = state.tasks[index];
    const updated: TaskRecord = { ...current, status, updatedAt: new Date().toISOString() };
    const taskFile = ensureRelativeInsideProject(paths.root, current.taskPath);
    const markdown = await readFile(taskFile, "utf8");

    await writeFile(taskFile, replaceMarkdownSection(markdown, "Status", status), "utf8");
    await this.writeState(projectPath, {
      tasks: state.tasks.map((task, taskIndex) => (taskIndex === index ? updated : task))
    });

    return updated;
  }

  async readReport(projectPath: string, taskId: string): Promise<TaskReport> {
    const paths = await ensureCodexStructure(projectPath);
    const task = await this.getTask(projectPath, taskId);
    const reportPath = ensureRelativeInsideProject(paths.root, task.reportPath);
    const markdown = await readFile(reportPath, "utf8").catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`Report not found for task ${taskId}: ${task.reportPath}`);
      }

      throw error;
    });

    return {
      taskId,
      reportPath: task.reportPath,
      markdown
    };
  }

  async approveTask(projectPath: string, taskId: string, decision: string): Promise<TaskRecord> {
    const task = await this.updateStatus(projectPath, taskId, "approved");
    await this.architectLog.record(projectPath, {
      taskId,
      type: "approval",
      title: `Task ${taskId} approved`,
      body: decision
    });
    return task;
  }

  async rejectTask(projectPath: string, taskId: string, reason: string, requiredFixes: string[]): Promise<TaskRecord> {
    const paths = await ensureCodexStructure(projectPath);
    const task = await this.updateStatus(projectPath, taskId, "rejected");
    const fixPath = path.join(paths.tasksDir, `${taskId}-fix.md`);
    const fixMarkdown = [
      `# Fix request for Task ${taskId}`,
      "",
      "## Reason",
      "",
      reason,
      "",
      "## Required Fixes",
      "",
      markdownList(requiredFixes, "- No fixes specified."),
      ""
    ].join("\n");

    await writeFile(fixPath, fixMarkdown, "utf8");
    await this.architectLog.record(projectPath, {
      taskId,
      type: "rejection",
      title: `Task ${taskId} rejected`,
      body: `${reason}\n\nRequired fixes:\n${markdownList(requiredFixes, "- No fixes specified.")}`
    });

    return task;
  }

  private async writeState(projectPath: string, state: TaskState): Promise<void> {
    const paths = await ensureCodexStructure(projectPath);
    await this.writeStateFile(paths.tasksStatePath, state);
  }

  private async readStateFile(statePath: string): Promise<TaskState> {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as TaskState;

    if (!Array.isArray(parsed.tasks)) {
      throw new Error("Invalid tasks state: tasks must be an array.");
    }

    for (const task of parsed.tasks) {
      if (!isTaskStatus(task.status)) {
        throw new Error(`Invalid task status in state: ${task.status}`);
      }
    }

    return parsed;
  }

  private async writeStateFile(statePath: string, state: TaskState): Promise<void> {
    await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  private nextTaskId(tasks: TaskRecord[]): string {
    const next = tasks.reduce((max, task) => Math.max(max, Number(task.id)), 0) + 1;
    return String(next).padStart(4, "0");
  }

  private renderTaskMarkdown(record: TaskRecord, input: CreateTaskData): string {
    return [
      `# Task ${record.id}: ${record.title}`,
      "",
      "## Status",
      "",
      record.status,
      "",
      "## Goal",
      "",
      input.goal,
      "",
      "## Context",
      "",
      input.context?.trim() || "Not specified.",
      "",
      "## Scope",
      "",
      markdownList(input.scope),
      "",
      "## Out of Scope",
      "",
      markdownList(input.outOfScope),
      "",
      "## Files Allowed",
      "",
      markdownList(input.filesAllowed),
      "",
      "## Acceptance Criteria",
      "",
      checklist(input.acceptanceCriteria),
      "",
      "## Required Checks",
      "",
      markdownList(input.requiredChecks),
      "",
      "## Report Required",
      "",
      "After completion create report:",
      "",
      record.reportPath,
      "",
      "## Notes for Codex",
      "",
      input.notes?.trim() ||
        "Make small safe changes. Do not add extra functionality. Do not store secrets in code. If something fails, mention it explicitly in the report.",
      ""
    ].join("\n");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
