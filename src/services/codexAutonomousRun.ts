import path from "node:path";
import { CodexNextService, type CodexNextResult } from "./codexNext.js";
import { CodexWorkerService, type CodexCliStatusSnapshot, type CodexWorkerDirectExecutionConfig, type CodexWorkerStatus } from "./codexWorker.js";
import { GitService } from "./gitService.js";
import type { DashboardProjectConfig } from "./dashboardConfig.js";

export type CodexAutonomousExecutionState =
  | "idle"
  | "blocked"
  | "dry_run"
  | "waiting_for_report"
  | "timeout"
  | "report_missing"
  | "report_detected"
  | "error";

export type CodexAutonomousNextAction =
  | "run_review_gate"
  | "inspect_diff"
  | "fix_blocker"
  | "inspect_worker_output"
  | "manual_codex_run";

export interface CodexAutonomousRunResult {
  projectPath?: string;
  taskId?: string;
  taskPath?: string;
  reportPath?: string;
  reportExists: boolean;
  executionState: CodexAutonomousExecutionState;
  changedFilesSummary: string[];
  nextRecommendedAction: CodexAutonomousNextAction;
  directExecutionEnabled: boolean;
  directExecutionReason: string;
  dryRun: boolean;
  message: string;
  plannedCommand?: string;
  workerState?: CodexWorkerStatus["state"];
  workerMessage?: string;
  codexCli?: CodexCliStatusSnapshot;
  configSource?: "local" | "default";
}

export interface CodexAutonomousRunOptions {
  projects: DashboardProjectConfig[];
  projectPath?: string;
  statusFilePath: string;
  pidFilePath: string;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  dryRun?: boolean;
  localConfigExists?: boolean;
  directExecution: Partial<CodexWorkerDirectExecutionConfig>;
}

export interface CodexAutonomousRunDependencies {
  codexNextService?: Pick<CodexNextService, "prepare">;
  codexWorkerService?: Pick<CodexWorkerService, "run" | "inspectEnvironment">;
  gitService?: Pick<GitService, "inspectDiff">;
}

export class CodexAutonomousRunService {
  private readonly codexNextService: Pick<CodexNextService, "prepare">;
  private readonly codexWorkerService: Pick<CodexWorkerService, "run" | "inspectEnvironment">;
  private readonly gitService: Pick<GitService, "inspectDiff">;

  constructor(dependencies: CodexAutonomousRunDependencies = {}) {
    this.codexNextService = dependencies.codexNextService ?? new CodexNextService();
    this.codexWorkerService = dependencies.codexWorkerService ?? new CodexWorkerService();
    this.gitService = dependencies.gitService ?? new GitService();
  }

  async run(options: CodexAutonomousRunOptions): Promise<CodexAutonomousRunResult> {
    const projects = resolveProjects(options.projects, options.projectPath);
    const directExecution = normalizeDirectExecution(options.directExecution);
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const waitTimeoutMs = options.waitTimeoutMs ?? 300_000;

    const pending = await this.findPendingTask(projects);
    if (!pending) {
      return {
        projectPath: options.projectPath,
        reportExists: false,
        executionState: "idle",
        changedFilesSummary: [],
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: directExecution.enabled,
        directExecutionReason: directExecution.enabled
          ? "direct execution is enabled by worker config, but there is no pending task to run."
          : "direct execution is disabled by worker config, and there is no pending task to run.",
        dryRun: Boolean(options.dryRun),
        message: "No pending task is available for an autonomous Codex run.",
        configSource: options.localConfigExists ? "local" : "default"
      };
    }

    const base = {
      projectPath: pending.project.path,
      taskId: pending.result.task?.id,
      taskPath: pending.result.task?.taskPath,
      reportPath: pending.result.task?.reportPath
    };
    const plannedCommand = buildPlannedCommand(directExecution);

    if (!directExecution.enabled) {
      return {
        ...base,
        reportExists: Boolean(pending.result.task?.reportExists),
        executionState: "blocked",
        changedFilesSummary: await this.changedFilesSummary(pending.project.path),
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: false,
        directExecutionReason: "worker.directExecution.enabled is false in the loaded dashboard config.",
        dryRun: Boolean(options.dryRun),
        message: "Direct execution is disabled. Enable worker.directExecution.enabled before asking Codex to run the next pending task autonomously.",
        plannedCommand,
        configSource: options.localConfigExists ? "local" : "default"
      };
    }

    const runtime = await this.codexWorkerService.inspectEnvironment(directExecution);
    if (!runtime.found || !runtime.execAvailable) {
      return {
        ...base,
        reportExists: Boolean(pending.result.task?.reportExists),
        executionState: "blocked",
        changedFilesSummary: await this.changedFilesSummary(pending.project.path),
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: true,
        directExecutionReason: runtime.found
          ? "Codex CLI was found, but codex exec is unavailable in the current runtime."
          : "Codex CLI was not found in the current runtime.",
        dryRun: Boolean(options.dryRun),
        message: runtime.found
          ? "Codex CLI is present, but codex exec is not available for the worker runtime."
          : "Codex CLI is not available for the worker runtime.",
        plannedCommand,
        codexCli: runtime,
        configSource: options.localConfigExists ? "local" : "default"
      };
    }

    if (options.dryRun) {
      return {
        ...base,
        reportExists: Boolean(pending.result.task?.reportExists),
        executionState: "dry_run",
        changedFilesSummary: await this.changedFilesSummary(pending.project.path),
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: true,
        directExecutionReason: "Direct execution is enabled in config, but dry-run prevented codex exec from running.",
        dryRun: true,
        message: "Dry-run mode is enabled. codex exec was not invoked.",
        plannedCommand,
        codexCli: runtime,
        configSource: options.localConfigExists ? "local" : "default"
      };
    }

    let status = await this.codexWorkerService.run({
      projects: [pending.project],
      once: true,
      pollIntervalMs,
      statusFilePath: options.statusFilePath,
      pidFilePath: options.pidFilePath,
      directExecution
    });

    if (status.state === "report_detected") {
      return this.resultFromWorkerStatus(status, {
        executionState: "report_detected",
        nextRecommendedAction: "run_review_gate",
        directExecutionEnabled: true,
        dryRun: false,
        changedFilesSummary: await this.changedFilesSummary(pending.project.path),
        directExecutionReason: "Direct execution ran and the task report was detected.",
        configSource: options.localConfigExists ? "local" : "default"
      });
    }

    if (status.state === "error") {
      return this.resultFromWorkerStatus(status, {
        executionState: "error",
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: true,
        dryRun: false,
        changedFilesSummary: await this.changedFilesSummary(pending.project.path),
        directExecutionReason: "Direct execution ran, but the worker returned an error state.",
        configSource: options.localConfigExists ? "local" : "default"
      });
    }

    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      await delay(pollIntervalMs);
      status = await this.codexWorkerService.run({
        projects: [pending.project],
        once: true,
        pollIntervalMs,
        statusFilePath: options.statusFilePath,
        pidFilePath: options.pidFilePath,
        directExecution
      });

      if (status.state === "report_detected") {
        return this.resultFromWorkerStatus(status, {
          executionState: "report_detected",
          nextRecommendedAction: "run_review_gate",
          directExecutionEnabled: true,
          dryRun: false,
          changedFilesSummary: await this.changedFilesSummary(pending.project.path),
          directExecutionReason: "Direct execution ran and the task report was detected.",
          configSource: options.localConfigExists ? "local" : "default"
        });
      }

      if (status.state === "error") {
        return this.resultFromWorkerStatus(status, {
          executionState: "error",
          nextRecommendedAction: "fix_blocker",
          directExecutionEnabled: true,
          dryRun: false,
          changedFilesSummary: await this.changedFilesSummary(pending.project.path),
          directExecutionReason: "Direct execution ran, but the worker returned an error state.",
          configSource: options.localConfigExists ? "local" : "default"
        });
      }
    }

    return this.resultFromWorkerStatus(status, {
      executionState: status.codexCli.lastExitCode === 0 ? "report_missing" : "timeout",
      nextRecommendedAction: status.codexCli.lastExitCode === 0 ? "inspect_worker_output" : "manual_codex_run",
      directExecutionEnabled: true,
      dryRun: false,
      changedFilesSummary: await this.changedFilesSummary(pending.project.path),
      directExecutionReason: status.codexCli.lastExitCode === 0
        ? buildReportMissingReason(status)
        : "codex exec did not reach a successful terminal report-detected state before timeout.",
      configSource: options.localConfigExists ? "local" : "default",
      messageOverride: buildTimeoutMessage(status, waitTimeoutMs)
    });
  }

  private async findPendingTask(projects: DashboardProjectConfig[]): Promise<
    | {
        project: DashboardProjectConfig;
        result: CodexNextResult;
      }
    | undefined
  > {
    for (const project of projects) {
      const result = await this.codexNextService.prepare({ projectPath: project.path });
      if (result.task && result.waitingFor === "codex" && !result.task.reportExists) {
        return { project, result };
      }
    }

    return undefined;
  }

  private async changedFilesSummary(projectPath: string): Promise<string[]> {
    const diff = await this.gitService.inspectDiff(projectPath, "names");
    return diff.output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private resultFromWorkerStatus(
    status: CodexWorkerStatus,
    input: {
      executionState: CodexAutonomousExecutionState;
      nextRecommendedAction: CodexAutonomousNextAction;
      directExecutionEnabled: boolean;
      directExecutionReason: string;
      dryRun: boolean;
      changedFilesSummary: string[];
      configSource?: "local" | "default";
      messageOverride?: string;
    }
  ): CodexAutonomousRunResult {
    return {
      projectPath: status.currentTask?.projectPath,
      taskId: status.currentTask?.taskId,
      taskPath: status.currentTask?.taskPath,
      reportPath: status.currentTask?.reportPath,
      reportExists: status.lastReportStatus === "detected" || Boolean(status.currentTask?.reportExists),
      executionState: input.executionState,
      changedFilesSummary: input.changedFilesSummary,
      nextRecommendedAction: input.nextRecommendedAction,
      directExecutionEnabled: input.directExecutionEnabled,
      directExecutionReason: input.directExecutionReason,
      dryRun: input.dryRun,
      message: input.messageOverride ?? status.message,
      workerState: status.state,
      workerMessage: status.message,
      codexCli: status.codexCli,
      configSource: input.configSource
    };
  }
}

function resolveProjects(projects: DashboardProjectConfig[], projectPath: string | undefined): DashboardProjectConfig[] {
  if (!projectPath) {
    return projects;
  }

  const selectedProjectPath = normalizeProjectPath(projectPath);
  const selected = projects.filter((project) => normalizeProjectPath(project.path) === selectedProjectPath);
  if (selected.length === 0) {
    throw new Error(`Managed project was not found in config: ${projectPath}`);
  }

  return selected;
}

function normalizeDirectExecution(input: Partial<CodexWorkerDirectExecutionConfig>): CodexWorkerDirectExecutionConfig {
  return {
    enabled: input.enabled ?? false,
    command: input.command?.trim() || "codex",
    sandbox: input.sandbox ?? "read-only",
    extraArgs: input.extraArgs ?? [],
    timeoutMs: input.timeoutMs ?? 1_200_000,
    dryRun: input.dryRun ?? false
  };
}

function buildPlannedCommand(directExecution: CodexWorkerDirectExecutionConfig): string {
  return [directExecution.command, "exec", "--skip-git-repo-check", "--sandbox", directExecution.sandbox, ...directExecution.extraArgs, "-"].join(" ");
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function normalizeProjectPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function buildTimeoutMessage(status: CodexWorkerStatus, waitTimeoutMs: number): string {
  const taskId = status.currentTask?.taskId ?? "unknown";
  const reportPath = status.currentTask?.reportPath ?? "the expected report path";
  const waitedMs = Math.max(0, waitTimeoutMs);
  const writeBlocker = detectReportWriteBlocker(status);

  if (status.codexCli.lastExitCode === 0) {
    if (writeBlocker) {
      return `codex exec finished for task ${taskId}, but report creation for ${reportPath} was blocked inside the Codex runtime (${writeBlocker}). Inspect the worker output and create the report manually if needed.`;
    }

    return `codex exec finished for task ${taskId}, but ${reportPath} was not detected within ${waitedMs} ms. Inspect the worker output and create the report manually if needed.`;
  }

  return `Timed out waiting ${waitedMs} ms for report detection for task ${taskId}. Inspect the worker output or run Codex manually before retrying.`;
}

function buildReportMissingReason(status: CodexWorkerStatus): string {
  const writeBlocker = detectReportWriteBlocker(status);
  if (writeBlocker) {
    return `codex exec finished successfully, but report creation was blocked inside the Codex runtime (${writeBlocker}).`;
  }

  return "codex exec finished successfully, but the expected report was not detected.";
}

function detectReportWriteBlocker(status: CodexWorkerStatus): string | undefined {
  const output = `${status.codexCli.lastError ?? ""}\n${status.message}`.toLowerCase();
  if (!output.trim()) {
    return undefined;
  }

  if (output.includes("access is denied") || output.includes("permission denied")) {
    return "write access denied";
  }

  if (output.includes("writing outside of the project")) {
    return "sandbox path rejected the report write";
  }

  return undefined;
}
