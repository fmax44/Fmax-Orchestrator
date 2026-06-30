import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa, type ExecaError } from "execa";
import { CodexNextService } from "./codexNext.js";
import type { DashboardProjectConfig, DashboardWorkerConfig } from "./dashboardConfig.js";
import { sanitizeOutput } from "../utils/safeExec.js";

export type CodexWorkerState = "idle" | "task_found" | "waiting_for_codex" | "report_detected" | "error";
export type CodexCliSandbox = DashboardWorkerConfig["directExecution"]["sandbox"];

export interface CodexWorkerDirectExecutionConfig {
  enabled: boolean;
  command: string;
  sandbox: CodexCliSandbox;
  extraArgs: string[];
  timeoutMs: number;
  dryRun: boolean;
}

export interface CodexCliStatusSnapshot {
  command: string;
  commandPath?: string;
  found: boolean;
  execAvailable: boolean;
  directExecutionEnabled: boolean;
  sandbox: CodexCliSandbox;
  lastExitCode?: number;
  lastError?: string;
}

export interface CodexWorkerTaskSummary {
  projectName: string;
  projectPath: string;
  taskId: string;
  title: string;
  status: string;
  taskPath: string;
  reportPath: string;
  reportExists: boolean;
  instruction: string;
}

export interface CodexWorkerStatus {
  state: CodexWorkerState;
  updatedAt: string;
  pollIntervalMs: number;
  message: string;
  currentTask?: CodexWorkerTaskSummary;
  lastReportStatus?: "missing" | "detected";
  directCodexLaunchSupported: false;
  limitations: string[];
  codexCli: CodexCliStatusSnapshot;
  host: string;
  pid: number;
}

export interface CodexWorkerRunOptions {
  projects: DashboardProjectConfig[];
  pollIntervalMs?: number;
  once?: boolean;
  statusFilePath: string;
  pidFilePath: string;
  directExecution?: Partial<CodexWorkerDirectExecutionConfig>;
  onStatus?: (status: CodexWorkerStatus) => void;
}

export interface CodexWorkerDependencies {
  codexNextService?: Pick<CodexNextService, "prepare">;
  officialCodexCli?: Pick<OfficialCodexCli, "probe" | "execute">;
}

interface CodexCliProbeResult {
  commandPath?: string;
  found: boolean;
  execAvailable: boolean;
  error?: string;
}

interface CodexCliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

const LIMITATIONS = [
  "Worker cannot safely drive Codex Desktop or submit prompts automatically from this CLI process.",
  "Worker only watches the queue, emits the Codex payload, and waits for a report file."
] as const;

export class CodexWorkerService {
  private readonly codexNextService: Pick<CodexNextService, "prepare">;
  private readonly officialCodexCli: Pick<OfficialCodexCli, "probe" | "execute">;

  constructor(dependencies: CodexWorkerDependencies = {}) {
    this.codexNextService = dependencies.codexNextService ?? new CodexNextService();
    this.officialCodexCli = dependencies.officialCodexCli ?? new OfficialCodexCli();
  }

  async run(options: CodexWorkerRunOptions): Promise<CodexWorkerStatus> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    const directExecution = normalizeDirectExecutionConfig(options.directExecution);
    await writePidFile(options.pidFilePath);

    let lastStatus = await this.readStatus(options.statusFilePath);

    try {
      while (true) {
        const nextStatus = await this.scanProjects({
          projects: options.projects,
          pollIntervalMs,
          directExecution,
          previousStatus: lastStatus
        });
        await this.writeStatus(options.statusFilePath, nextStatus);
        options.onStatus?.(nextStatus);
        lastStatus = nextStatus;

        if (options.once) {
          return nextStatus;
        }

        await delay(pollIntervalMs);
      }
    } catch (error: unknown) {
      const failedStatus: CodexWorkerStatus = {
        state: "error",
        updatedAt: new Date().toISOString(),
        pollIntervalMs,
        message: error instanceof Error ? error.message : String(error),
        lastReportStatus: lastStatus?.lastReportStatus,
        currentTask: lastStatus?.currentTask,
        directCodexLaunchSupported: false,
        limitations: [...LIMITATIONS],
        codexCli: lastStatus?.codexCli ?? createUnavailableCliStatus(directExecution),
        host: os.hostname(),
        pid: process.pid
      };
      await this.writeStatus(options.statusFilePath, failedStatus);
      options.onStatus?.(failedStatus);
      throw error;
    } finally {
      await removePidFile(options.pidFilePath).catch(() => undefined);
    }
  }

  async readStatus(statusFilePath: string): Promise<CodexWorkerStatus | undefined> {
    return readFile(statusFilePath, "utf8")
      .then((content) => JSON.parse(content) as CodexWorkerStatus)
      .catch(() => undefined);
  }

  async inspectEnvironment(directExecution?: Partial<CodexWorkerDirectExecutionConfig>): Promise<CodexCliStatusSnapshot> {
    const normalized = normalizeDirectExecutionConfig(directExecution);
    const probe = await this.officialCodexCli.probe(normalized);
    return {
      command: normalized.command,
      commandPath: probe.commandPath,
      found: probe.found,
      execAvailable: probe.execAvailable,
      directExecutionEnabled: normalized.enabled,
      sandbox: normalized.sandbox,
      lastError: probe.error
    };
  }

  private async writeStatus(statusFilePath: string, status: CodexWorkerStatus): Promise<void> {
    await mkdir(path.dirname(statusFilePath), { recursive: true });
    await writeFile(statusFilePath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  }

  private async scanProjects(input: {
    projects: DashboardProjectConfig[];
    pollIntervalMs: number;
    directExecution: CodexWorkerDirectExecutionConfig;
    previousStatus?: CodexWorkerStatus;
  }): Promise<CodexWorkerStatus> {
    const cliProbe = await this.officialCodexCli.probe(input.directExecution);

    for (const project of input.projects) {
      const result = await this.codexNextService.prepare({ projectPath: project.path });
      if (!result.task) {
        continue;
      }

      const task: CodexWorkerTaskSummary = {
        projectName: project.name,
        projectPath: result.projectPath,
        taskId: result.task.id,
        title: result.task.title,
        status: result.task.status,
        taskPath: result.task.taskPath,
        reportPath: result.task.reportPath,
        reportExists: result.task.reportExists,
        instruction: result.codexInstruction
      };
      const previousTaskId = input.previousStatus?.currentTask?.taskId;
      const sameTask = previousTaskId === task.taskId && input.previousStatus?.currentTask?.projectPath === task.projectPath;
      const previousCli = input.previousStatus?.codexCli;

      if (result.task.reportExists || result.waitingFor === "chatgpt") {
        return buildStatus("report_detected", input.pollIntervalMs, {
          currentTask: task,
          lastReportStatus: "detected",
          message: `Report detected for task ${task.taskId} in ${project.name}. ChatGPT should review ${task.reportPath}.`,
          codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
        });
      }

      if (input.directExecution.enabled) {
        if (!cliProbe.found) {
          return buildStatus(sameTask ? "waiting_for_codex" : "task_found", input.pollIntervalMs, {
            currentTask: task,
            lastReportStatus: "missing",
            message: `Pending task ${task.taskId} found in ${project.name}, but official Codex CLI was not found. Keep the current worker detection/report-watch flow and run the task manually after Codex CLI is installed or fixed.`,
            codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
          });
        }

        if (!cliProbe.execAvailable) {
          return buildStatus(sameTask ? "waiting_for_codex" : "task_found", input.pollIntervalMs, {
            currentTask: task,
            lastReportStatus: "missing",
            message: `Pending task ${task.taskId} found in ${project.name}, but codex exec is not available right now. Keep the current worker detection/report-watch flow and fix the local Codex CLI manually.`,
            codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
          });
        }

        if (!sameTask) {
          if (input.directExecution.dryRun) {
            return buildStatus("task_found", input.pollIntervalMs, {
              currentTask: task,
              lastReportStatus: "missing",
              message: `Pending task ${task.taskId} found in ${project.name}. Direct execution dry-run is enabled, so the worker stopped before running codex exec.`,
              codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
            });
          }

          const execution = await this.officialCodexCli.execute({
            task,
            instruction: task.instruction,
            directExecution: input.directExecution
          });
          const reportExistsAfterExecution = await reportExists(task.projectPath, task.reportPath);
          const codexCli = mergeCliStatus(input.directExecution, cliProbe, previousCli, {
            lastExitCode: execution.exitCode,
            lastError: execution.error || execution.stderr || undefined
          });

          if (reportExistsAfterExecution) {
            return buildStatus("report_detected", input.pollIntervalMs, {
              currentTask: {
                ...task,
                reportExists: true
              },
              lastReportStatus: "detected",
              message: `codex exec finished for task ${task.taskId} in ${project.name} and the report was detected. ChatGPT should review ${task.reportPath}.`,
              codexCli
            });
          }

          return buildStatus("waiting_for_codex", input.pollIntervalMs, {
            currentTask: task,
            lastReportStatus: "missing",
            message: execution.exitCode === 0
              ? `codex exec finished for task ${task.taskId} in ${project.name}, but the report is still missing. Check the Codex CLI output and create ${task.reportPath} manually if needed.`
              : `codex exec failed for task ${task.taskId} in ${project.name}. Keep the current worker detection/report-watch flow and fix Codex CLI or authentication manually before retrying.`,
            codexCli
          });
        }
      }

      if (sameTask) {
        return buildStatus("waiting_for_codex", input.pollIntervalMs, {
          currentTask: task,
          lastReportStatus: "missing",
          message: `Waiting for Codex report for task ${task.taskId} in ${project.name}.`,
          codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
        });
      }

      return buildStatus("task_found", input.pollIntervalMs, {
        currentTask: task,
        lastReportStatus: "missing",
        message: `Pending task ${task.taskId} found in ${project.name}. Worker prepared the Codex payload and is now waiting for a report.`,
        codexCli: mergeCliStatus(input.directExecution, cliProbe, previousCli)
      });
    }

    return buildStatus("idle", input.pollIntervalMs, {
      currentTask: undefined,
      lastReportStatus: input.previousStatus?.lastReportStatus,
      message: "No pending tasks were found in managed projects.",
      codexCli: mergeCliStatus(input.directExecution, cliProbe, input.previousStatus?.codexCli)
    });
  }
}

function buildStatus(
  state: CodexWorkerState,
  pollIntervalMs: number,
  input: Pick<CodexWorkerStatus, "message" | "currentTask" | "lastReportStatus" | "codexCli">
): CodexWorkerStatus {
  return {
    state,
    updatedAt: new Date().toISOString(),
    pollIntervalMs,
    message: input.message,
    currentTask: input.currentTask,
    lastReportStatus: input.lastReportStatus,
    directCodexLaunchSupported: false,
    limitations: [...LIMITATIONS],
    codexCli: input.codexCli,
    host: os.hostname(),
    pid: process.pid
  };
}

class OfficialCodexCli {
  async probe(config: CodexWorkerDirectExecutionConfig): Promise<CodexCliProbeResult> {
    const commandPath = await resolveCommandPath(config.command);
    if (!commandPath) {
      return {
        found: false,
        execAvailable: false,
        error: `Command not found: ${config.command}`
      };
    }

    const version = await runCommand(config.command, ["--version"], process.cwd(), 30_000);
    if (version.exitCode !== 0) {
      return {
        commandPath,
        found: true,
        execAvailable: false,
        error: version.error || version.stderr || "codex --version failed"
      };
    }

    const execHelp = await runCommand(config.command, ["exec", "--help"], process.cwd(), 30_000);
    return {
      commandPath,
      found: true,
      execAvailable: execHelp.exitCode === 0,
      error: execHelp.exitCode === 0 ? undefined : execHelp.error || execHelp.stderr || "codex exec --help failed"
    };
  }

  async execute(input: {
    task: CodexWorkerTaskSummary;
    instruction: string;
    directExecution: CodexWorkerDirectExecutionConfig;
  }): Promise<CodexCliExecutionResult> {
    const args = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      input.directExecution.sandbox,
      ...input.directExecution.extraArgs,
      "-"
    ];

    return runCommand(
      input.directExecution.command,
      args,
      input.task.projectPath,
      input.directExecution.timeoutMs,
      input.instruction
    );
  }
}

function normalizeDirectExecutionConfig(
  input: Partial<CodexWorkerDirectExecutionConfig> | undefined
): CodexWorkerDirectExecutionConfig {
  return {
    enabled: input?.enabled ?? false,
    command: input?.command?.trim() || "codex",
    sandbox: input?.sandbox ?? "read-only",
    extraArgs: input?.extraArgs ?? [],
    timeoutMs: input?.timeoutMs ?? 1_200_000,
    dryRun: input?.dryRun ?? false
  };
}

function mergeCliStatus(
  directExecution: CodexWorkerDirectExecutionConfig,
  probe: CodexCliProbeResult,
  previous: CodexCliStatusSnapshot | undefined,
  override: Partial<Pick<CodexCliStatusSnapshot, "lastExitCode" | "lastError">> = {}
): CodexCliStatusSnapshot {
  return {
    command: directExecution.command,
    commandPath: probe.commandPath ?? previous?.commandPath,
    found: probe.found,
    execAvailable: probe.execAvailable,
    directExecutionEnabled: directExecution.enabled,
    sandbox: directExecution.sandbox,
    lastExitCode: override.lastExitCode ?? previous?.lastExitCode,
    lastError: override.lastError ?? probe.error ?? previous?.lastError
  };
}

function createUnavailableCliStatus(directExecution: CodexWorkerDirectExecutionConfig): CodexCliStatusSnapshot {
  return {
    command: directExecution.command,
    found: false,
    execAvailable: false,
    directExecutionEnabled: directExecution.enabled,
    sandbox: directExecution.sandbox
  };
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  input?: string
): Promise<CodexCliExecutionResult> {
  try {
    const result = await execa(command, args, {
      cwd,
      reject: false,
      timeout: timeoutMs,
      windowsHide: true,
      input,
      env: {
        ...process.env,
        NO_COLOR: "1"
      }
    });
    return {
      exitCode: result.exitCode ?? 0,
      stdout: sanitizeOutput(String(result.stdout ?? "")),
      stderr: sanitizeOutput(String(result.stderr ?? ""))
    };
  } catch (error: unknown) {
    const execaError = error as ExecaError;
    return {
      exitCode: typeof execaError.exitCode === "number" ? execaError.exitCode : 1,
      stdout: sanitizeOutput(String(execaError.stdout ?? "")),
      stderr: sanitizeOutput(String(execaError.stderr ?? execaError.message ?? error)),
      error: sanitizeOutput(String(execaError.shortMessage ?? execaError.message ?? error))
    };
  }
}

async function resolveCommandPath(command: string): Promise<string | undefined> {
  if (path.isAbsolute(command)) {
    return stat(command).then(() => command).catch(() => undefined);
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const result = await runCommand(locator, [command], process.cwd(), 10_000);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function reportExists(projectPath: string, reportPath: string): Promise<boolean> {
  return stat(path.join(projectPath, reportPath))
    .then(() => true)
    .catch(() => false);
}

async function writePidFile(pidFilePath: string): Promise<void> {
  await mkdir(path.dirname(pidFilePath), { recursive: true });
  await writeFile(
    pidFilePath,
    `${JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8"
  );
}

async function removePidFile(pidFilePath: string): Promise<void> {
  await stat(pidFilePath).then(() => unlink(pidFilePath)).catch(() => undefined);
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
