import { mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { CreateTaskData, ReviewGateProvenance, TaskRecord, TaskState } from "../domain/task.js";
import type { TaskReport } from "../domain/report.js";
import type { TaskStatus } from "../domain/status.js";
import { isTaskStatus } from "../domain/status.js";
import { readUtf8File, stripUtf8Bom, writeUtf8FileAtomic } from "../utils/fileIO.js";
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
    const id = await this.nextTaskId(paths.root, state.tasks);
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

    await writeUtf8FileAtomic(taskPath, this.renderTaskMarkdown(record, input));
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

  async listTasks(projectPath: string, status?: TaskStatus): Promise<TaskRecord[]> {
    const state = { tasks: await this.syncReportedTasks(projectPath) };
    return status ? state.tasks.filter((task) => task.status === status) : state.tasks;
  }

  async syncReportedTasks(projectPath: string): Promise<TaskRecord[]> {
    const paths = await ensureCodexStructure(projectPath);
    const state = await this.readState(projectPath);
    const updatedTasks = await Promise.all(
      state.tasks.map(async (task) => {
        if (task.status !== "pending") {
          return task;
        }

        const reportPath = ensureRelativeInsideProject(paths.root, task.reportPath);
        const reportMarkdown = await readUtf8File(reportPath).catch(() => undefined);

        if (!reportMarkdown || !isTaskReportForTask(reportMarkdown, task.id)) {
          return task;
        }

        const taskFile = ensureRelativeInsideProject(paths.root, task.taskPath);
        const markdown = await readUtf8File(taskFile).catch((error: unknown) => {
          if (isNodeError(error) && error.code === "ENOENT") {
            return undefined;
          }

          throw error;
        });
        const updated: TaskRecord = {
          ...task,
          status: "reported",
          updatedAt: new Date().toISOString()
        };

        if (markdown !== undefined) {
          await writeUtf8FileAtomic(taskFile, replaceMarkdownSection(markdown, "Status", "reported"));
        }

        return updated;
      })
    );

    const changed = updatedTasks.some((task, index) => task.status !== state.tasks[index]?.status || task.updatedAt !== state.tasks[index]?.updatedAt);
    if (changed) {
      await this.writeState(projectPath, { tasks: updatedTasks });
    }

    return updatedTasks;
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
    const markdown = await this.readTaskMarkdownWithFallback(paths.root, current);
    const nextMarkdown = replaceMarkdownSection(markdown, "Status", status);

    try {
      await writeUtf8FileAtomic(taskFile, nextMarkdown);
    } catch (error: unknown) {
      if (!isRetriableTaskFileSyncError(error)) {
        throw error;
      }
    }

    await this.writeState(projectPath, {
      tasks: state.tasks.map((task, taskIndex) => (taskIndex === index ? updated : task))
    });

    return updated;
  }

  async readReport(projectPath: string, taskId: string): Promise<TaskReport> {
    const paths = await ensureCodexStructure(projectPath);
    const task = await this.getTask(projectPath, taskId);
    const reportPath = ensureRelativeInsideProject(paths.root, task.reportPath);
    const markdown = await readUtf8File(reportPath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`Report not found for task ${taskId}: ${task.reportPath}`);
      }

      throw error;
    });

    if (!isTaskReportForTask(markdown, taskId)) {
      throw new Error(`Report content does not belong to task ${taskId}: ${task.reportPath}`);
    }

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

  async updateReviewGate(projectPath: string, taskId: string, provenance: ReviewGateProvenance): Promise<TaskRecord> {
    const state = await this.readState(projectPath);
    const index = state.tasks.findIndex((task) => task.id === taskId);

    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const updated: TaskRecord = {
      ...state.tasks[index],
      lastReviewGate: provenance,
      updatedAt: new Date().toISOString()
    };

    await this.writeState(projectPath, {
      tasks: state.tasks.map((task, taskIndex) => (taskIndex === index ? updated : task))
    });

    return updated;
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

    await writeUtf8FileAtomic(fixPath, fixMarkdown);
    await this.architectLog.record(projectPath, {
      taskId,
      type: "rejection",
      title: `Task ${taskId} rejected`,
      body: `${reason}\n\nRequired fixes:\n${markdownList(requiredFixes, "- No fixes specified.")}`
    });

    return task;
  }

  async archiveTask(projectPath: string, taskId: string, reason: string): Promise<TaskRecord> {
    const paths = await ensureCodexStructure(projectPath);
    const state = await this.readState(projectPath);
    const index = state.tasks.findIndex((task) => task.id === taskId);

    if (index === -1) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const current = state.tasks[index];

    if (current.status !== "approved" && current.status !== "rejected") {
      throw new Error(`Only approved or rejected tasks can be archived. Task ${taskId} is ${current.status}.`);
    }

    const archiveDir = path.join(paths.archiveDir, taskId);
    await mkdir(archiveDir, { recursive: true });
    const taskPath = await moveIfExists(paths.root, current.taskPath, archiveDir);
    const reportPath = await moveIfExists(paths.root, current.reportPath, archiveDir);
    await moveIfExists(paths.root, `.codex/tasks/${taskId}-fix.md`, archiveDir);

    const updated: TaskRecord = {
      ...current,
      status: "archived",
      taskPath: taskPath ?? current.taskPath,
      reportPath: reportPath ?? current.reportPath,
      updatedAt: new Date().toISOString()
    };

    if (taskPath) {
      const absoluteTaskPath = ensureRelativeInsideProject(paths.root, taskPath);
      const markdown = await readUtf8File(absoluteTaskPath);
      await writeUtf8FileAtomic(absoluteTaskPath, replaceMarkdownSection(markdown, "Status", "archived"));
    }

    await this.writeState(projectPath, {
      tasks: state.tasks.map((task, taskIndex) => (taskIndex === index ? updated : task))
    });
    await this.architectLog.record(projectPath, {
      taskId,
      type: "archive",
      title: `Task ${taskId} archived`,
      body: reason
    });

    return updated;
  }

  private async writeState(projectPath: string, state: TaskState): Promise<void> {
    const paths = await ensureCodexStructure(projectPath);
    await this.writeStateFile(paths.tasksStatePath, state);
  }

  private async readStateFile(statePath: string): Promise<TaskState> {
    const raw = stripUtf8Bom(await readFile(statePath, "utf8"));
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
    await writeUtf8FileAtomic(statePath, JSON.stringify(state, null, 2) + "\n");
  }

  private async nextTaskId(projectPath: string, tasks: TaskRecord[]): Promise<string> {
    const reservedIds = new Set<number>();

    for (const task of tasks) {
      reservedIds.add(Number(task.id));
    }

    const relativeDirectories = [
      ".codex/tasks",
      ".codex/reports",
      ".codex/archive"
    ];

    for (const relativeDirectory of relativeDirectories) {
      const directory = ensureRelativeInsideProject(projectPath, relativeDirectory);
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const id = entry.isDirectory()
          ? parseTaskId(entry.name)
          : parseTaskId(path.basename(entry.name));
        if (id !== undefined) {
          reservedIds.add(id);
        }
      }
    }

    const next = [...reservedIds].reduce((max, id) => Math.max(max, id), 0) + 1;
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
      "## Policy Notes",
      "",
      markdownList(input.policyNotes),
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

  private async readTaskMarkdownWithFallback(projectPath: string, task: TaskRecord): Promise<string> {
    const taskFile = ensureRelativeInsideProject(projectPath, task.taskPath);
    const markdown = await readUtf8File(taskFile).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    });

    if (markdown !== undefined) {
      return markdown;
    }

    return renderRecoveredTaskMarkdown(task);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRetriableTaskFileSyncError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY");
}

async function moveIfExists(projectPath: string, relativePath: string, archiveDir: string): Promise<string | undefined> {
  const source = ensureRelativeInsideProject(projectPath, relativePath);
  const exists = await stat(source)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    return undefined;
  }

  const destination = path.join(archiveDir, path.basename(relativePath));
  await rename(source, destination);
  return toProjectRelative(projectPath, destination);
}

function parseTaskId(name: string): number | undefined {
  const match = name.match(/^(\d{4})-(?:task|report|review|fix)\.md$/) ?? name.match(/^(\d{4})$/);
  return match ? Number(match[1]) : undefined;
}

function isTaskReportForTask(markdown: string, taskId: string): boolean {
  return new RegExp(`^# Report for Task ${escapeRegExp(taskId)}\\b`, "m").test(stripUtf8Bom(markdown));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderRecoveredTaskMarkdown(task: TaskRecord): string {
  return [
    `# Task ${task.id}: ${task.title}`,
    "",
    "## Status",
    "",
    task.status,
    "",
    "## Goal",
    "",
    "Recovered from .codex/state/tasks.json after the original task markdown became unavailable.",
    "",
    "## Summary",
    "",
    `Recovered task file for ${task.id}.`,
    "",
    "## Paths",
    "",
    `- taskPath: ${task.taskPath}`,
    `- reportPath: ${task.reportPath}`,
    ""
  ].join("\n");
}
