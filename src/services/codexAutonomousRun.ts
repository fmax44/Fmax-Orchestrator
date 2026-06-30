import { CodexNextService, type CodexNextResult } from "./codexNext.js";
import { CodexWorkerService, type CodexCliStatusSnapshot, type CodexWorkerDirectExecutionConfig, type CodexWorkerStatus } from "./codexWorker.js";
import { GitService } from "./gitService.js";
import type { DashboardProjectConfig } from "./dashboardConfig.js";

export type CodexAutonomousExecutionState =
  | "idle"
  | "blocked"
  | "dry_run"
  | "waiting_for_report"
  | "report_detected"
  | "error";

export type CodexAutonomousNextAction = "run_review_gate" | "inspect_diff" | "fix_blocker";

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
  dryRun: boolean;
  message: string;
  plannedCommand?: string;
  workerState?: CodexWorkerStatus["state"];
  workerMessage?: string;
  codexCli?: CodexCliStatusSnapshot;
}

export interface CodexAutonomousRunOptions {
  projects: DashboardProjectConfig[];
  projectPath?: string;
  statusFilePath: string;
  pidFilePath: string;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  dryRun?: boolean;
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
        dryRun: Boolean(options.dryRun),
        message: "No pending task is available for an autonomous Codex run."
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
        dryRun: Boolean(options.dryRun),
        message: "Direct execution is disabled. Enable worker.directExecution.enabled before asking Codex to run the next pending task autonomously.",
        plannedCommand
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
        dryRun: Boolean(options.dryRun),
        message: runtime.found
          ? "Codex CLI is present, but codex exec is not available for the worker runtime."
          : "Codex CLI is not available for the worker runtime.",
        plannedCommand,
        codexCli: runtime
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
        dryRun: true,
        message: "Dry-run mode is enabled. codex exec was not invoked.",
        plannedCommand,
        codexCli: runtime
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
        changedFilesSummary: await this.changedFilesSummary(pending.project.path)
      });
    }

    if (status.state === "error") {
      return this.resultFromWorkerStatus(status, {
        executionState: "error",
        nextRecommendedAction: "fix_blocker",
        directExecutionEnabled: true,
        dryRun: false,
        changedFilesSummary: await this.changedFilesSummary(pending.project.path)
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
          changedFilesSummary: await this.changedFilesSummary(pending.project.path)
        });
      }

      if (status.state === "error") {
        return this.resultFromWorkerStatus(status, {
          executionState: "error",
          nextRecommendedAction: "fix_blocker",
          directExecutionEnabled: true,
          dryRun: false,
          changedFilesSummary: await this.changedFilesSummary(pending.project.path)
        });
      }
    }

    return this.resultFromWorkerStatus(status, {
      executionState: "waiting_for_report",
      nextRecommendedAction: "inspect_diff",
      directExecutionEnabled: true,
      dryRun: false,
      changedFilesSummary: await this.changedFilesSummary(pending.project.path)
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
      dryRun: boolean;
      changedFilesSummary: string[];
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
      dryRun: input.dryRun,
      message: status.message,
      workerState: status.state,
      workerMessage: status.message,
      codexCli: status.codexCli
    };
  }
}

function resolveProjects(projects: DashboardProjectConfig[], projectPath: string | undefined): DashboardProjectConfig[] {
  if (!projectPath) {
    return projects;
  }

  const selected = projects.filter((project) => project.path === projectPath);
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
