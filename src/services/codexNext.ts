import path from "node:path";
import { TaskStore } from "./taskStore.js";
import { type TaskRecord } from "../domain/task.js";

export interface CodexNextOptions {
  projectPath: string;
  watch?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface CodexNextResult {
  projectPath: string;
  task?: {
    id: string;
    title: string;
    status: TaskRecord["status"];
    taskPath: string;
    reportPath: string;
    reportExists: boolean;
  };
  waitingFor: "codex" | "chatgpt" | "user";
  nextAction: string;
  codexInstruction: string;
  watch: {
    enabled: boolean;
    timeoutMs: number;
    reportDetected: boolean;
    timedOut: boolean;
  };
}

export class CodexNextService {
  constructor(private readonly taskStore = new TaskStore()) {}

  async prepare(options: CodexNextOptions): Promise<CodexNextResult> {
    const projectPath = path.resolve(options.projectPath);
    await this.taskStore.syncReportedTasks(projectPath);
    const pendingTasks = await this.taskStore.listTasks(projectPath, "pending");
    const reportedTasks = await this.taskStore.listTasks(projectPath, "reported");
    const task = pendingTasks.at(-1);
    const timeoutMs = options.timeoutMs ?? 300_000;
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;

    if (!task) {
      const reportedTask = reportedTasks.at(-1);
      return {
        projectPath,
        task: reportedTask
          ? {
              id: reportedTask.id,
              title: reportedTask.title,
              status: reportedTask.status,
              taskPath: reportedTask.taskPath,
              reportPath: reportedTask.reportPath,
              reportExists: true
            }
          : undefined,
        waitingFor: reportedTask ? "chatgpt" : "chatgpt",
        nextAction: reportedTask
          ? `No pending task is left. ChatGPT should review reported task ${reportedTask.id}.`
          : "No pending task was found. Create a task through ChatGPT or review reported work.",
        codexInstruction: reportedTask
          ? `Task ${reportedTask.id} is already reported. Codex should stop and wait for ChatGPT review.`
          : "No pending task is available for Codex right now.",
        watch: {
          enabled: Boolean(options.watch),
          timeoutMs,
          reportDetected: false,
          timedOut: false
        }
      };
    }

    let reportDetected = await this.hasValidatedReport(projectPath, task.id);
    let timedOut = false;

    if (options.watch && !reportDetected) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await delay(pollIntervalMs);
        reportDetected = await this.hasValidatedReport(projectPath, task.id);
        if (reportDetected) {
          await this.taskStore.updateStatus(projectPath, task.id, "reported");
          break;
        }
      }

      timedOut = !reportDetected;
    }

    return {
      projectPath,
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        taskPath: task.taskPath,
        reportPath: task.reportPath,
        reportExists: reportDetected
      },
      waitingFor: reportDetected ? "chatgpt" : "codex",
      nextAction: reportDetected
        ? `Report for task ${task.id} is available. ChatGPT should read ${task.reportPath} and run review_gate.`
        : `Open Codex Desktop and execute task ${task.id} from ${task.taskPath}.`,
      codexInstruction: renderCodexInstruction(task),
      watch: {
        enabled: Boolean(options.watch),
        timeoutMs,
        reportDetected,
        timedOut
      }
    };
  }

  private async hasValidatedReport(projectPath: string, taskId: string): Promise<boolean> {
    return this.taskStore.readReport(projectPath, taskId)
      .then(() => true)
      .catch(() => false);
  }
}

export function formatCodexNextText(result: CodexNextResult): string {
  const lines = [
    "Next Codex task:",
    "",
    `Project: ${result.projectPath}`
  ];

  if (!result.task) {
    lines.push(
      "Pending task: none",
      `Waiting for: ${label(result.waitingFor)}`,
      `Next action: ${result.nextAction}`,
      "",
      result.codexInstruction
    );
    return lines.join("\n");
  }

  lines.push(
    `Pending task: ${result.task.id}`,
    `Task title: ${result.task.title}`,
    `Task path: ${result.task.taskPath}`,
    `Expected report: ${result.task.reportPath}`,
    `Waiting for: ${label(result.waitingFor)}`,
    `Next action: ${result.nextAction}`,
    "",
    "Instruction for Codex:",
    result.codexInstruction
  );

  if (result.watch.enabled) {
    lines.push(
      "",
      `Watch mode: ${result.watch.reportDetected ? "report detected" : result.watch.timedOut ? "timed out" : "completed"}`,
      `Watch timeout: ${result.watch.timeoutMs} ms`
    );
  }

  return lines.join("\n");
}

function renderCodexInstruction(task: TaskRecord): string {
  return [
    `1. Open task file ${task.taskPath}.`,
    "2. Implement only the scoped task.",
    `3. Create report ${task.reportPath}.`,
    "4. Do not approve the task automatically.",
    "5. Stop after the report is ready."
  ].join("\n");
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function label(value: string): string {
  switch (value) {
    case "chatgpt":
      return "ChatGPT";
    case "codex":
      return "Codex";
    default:
      return value;
  }
}
