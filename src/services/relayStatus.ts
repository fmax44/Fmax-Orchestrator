import { ProjectStatusService, type ProjectStatusOptions, type ProjectStatusResult } from "./projectStatus.js";

export interface RelayStatusResult {
  projectPath: string;
  projectName: string;
  currentTask?: {
    id: string;
    title: string;
    status: ProjectStatusResult["currentTask"] extends infer T
      ? T extends { status: infer S }
        ? S
        : never
      : never;
    taskPath: string;
    reportPath: string;
    reportExists: boolean;
    reviewExists: boolean;
  };
  waitingFor: ProjectStatusResult["waitingFor"];
  nextActor: ProjectStatusResult["nextActor"];
  nextAction: string;
  recommendedAction: ProjectStatusResult["recommendedAction"];
  doctorResult?: ProjectStatusResult["doctor"] extends infer T
    ? T extends { result: infer R }
      ? R
      : never
    : never;
  errors: string[];
  warnings: string[];
}

export class RelayStatusService {
  constructor(private readonly projectStatusService = new ProjectStatusService()) {}

  async check(options: ProjectStatusOptions): Promise<RelayStatusResult> {
    const status = await this.projectStatusService.check(options);

    return {
      projectPath: status.projectPath,
      projectName: status.projectName,
      currentTask: status.currentTask
        ? {
            id: status.currentTask.id,
            title: status.currentTask.title,
            status: status.currentTask.status,
            taskPath: status.currentTask.taskPath,
            reportPath: status.currentTask.reportPath,
            reportExists: status.currentTask.reportExists,
            reviewExists: status.currentTask.reviewExists
          }
        : undefined,
      waitingFor: status.waitingFor,
      nextActor: status.nextActor,
      nextAction: status.nextAction,
      recommendedAction: status.recommendedAction,
      doctorResult: status.doctor?.result,
      errors: status.errors,
      warnings: status.warnings
    };
  }
}

export function formatRelayStatusText(status: RelayStatusResult): string {
  const lines = [
    "Current relay state:",
    "",
    `Project: ${status.projectName}`,
    `Current task: ${status.currentTask ? status.currentTask.id : "none"}`,
    `Task status: ${status.currentTask?.status ?? "none"}`,
    `Waiting for: ${label(status.waitingFor)}`,
    `Next actor: ${label(status.nextActor)}`,
    `Next action: ${status.nextAction}`
  ];

  if (status.currentTask) {
    lines.push(
      `Task path: ${status.currentTask.taskPath}`,
      `Expected report: ${status.currentTask.reportPath}`,
      `Task report exists: ${status.currentTask.reportExists ? "yes" : "no"}`,
      `Review report exists: ${status.currentTask.reviewExists ? "yes" : "no"}`
    );
  }

  if (status.warnings.length) {
    lines.push("", "Warnings:", ...status.warnings.map((warning) => `- ${warning}`));
  }

  if (status.errors.length) {
    lines.push("", "Errors:", ...status.errors.map((error) => `- ${error}`));
  }

  return lines.join("\n");
}

function label(value: string): string {
  switch (value) {
    case "chatgpt":
      return "ChatGPT";
    case "codex":
      return "Codex";
    case "review":
      return "ChatGPT review";
    case "commit":
      return "commit";
    default:
      return value;
  }
}
