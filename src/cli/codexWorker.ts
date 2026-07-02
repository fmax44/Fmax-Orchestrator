import path from "node:path";
import { loadDashboardConfig } from "../services/dashboardConfig.js";
import { CodexWorkerService } from "../services/codexWorker.js";

const args = parseArgs(process.argv.slice(2));
const orchestratorRoot = process.cwd();

try {
  const loaded = await loadDashboardConfig(orchestratorRoot);
  const managedProjects = args.project
    ? loaded.config.managedProjects.filter((project) => path.resolve(project.path) === path.resolve(args.project!))
    : loaded.config.managedProjects;

  if (managedProjects.length === 0) {
    throw new Error(`Managed project was not found in config: ${args.project}`);
  }

  const service = new CodexWorkerService();
  const directExecutionEnabled = args.directExecution && loaded.config.worker.directExecution.enabled;
  const result = await service.run({
    projects: managedProjects,
    pollIntervalMs: args.pollIntervalMs ?? loaded.config.worker.pollIntervalMs,
    once: args.once,
    statusFilePath: args.statusFile ?? loaded.config.worker.statusFilePath,
    pidFilePath: loaded.config.worker.pidFilePath,
    directExecution: {
      ...loaded.config.worker.directExecution,
      enabled: directExecutionEnabled,
      command: args.codexCommand ?? loaded.config.worker.directExecution.command,
      sandbox: directExecutionEnabled ? args.codexSandbox ?? loaded.config.worker.directExecution.sandbox : "read-only",
      timeoutMs: args.codexTimeoutMs ?? loaded.config.worker.directExecution.timeoutMs,
      dryRun: args.codexDryRun || loaded.config.worker.directExecution.dryRun,
      extraArgs: args.codexExtraArgs.length > 0 ? args.codexExtraArgs : loaded.config.worker.directExecution.extraArgs
    },
    onStatus: args.format === "text" && !args.once
      ? (status) => {
          console.log(formatWorkerStatusText(status));
          console.log("");
        }
      : undefined
  });

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.once) {
    console.log(formatWorkerStatusText(result));
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function formatWorkerStatusText(status: {
  state: string;
  message: string;
  updatedAt: string;
  currentTask?: {
    projectName: string;
    taskId: string;
    title: string;
    taskPath: string;
    reportPath: string;
    instruction: string;
  };
  directCodexLaunchSupported: boolean;
  codexCli: {
    found: boolean;
    execAvailable: boolean;
    directExecutionEnabled: boolean;
    sandbox: string;
    lastExitCode?: number;
    lastError?: string;
  };
}): string {
  const lines = [
    "Codex Worker:",
    `State: ${status.state}`,
    `Updated: ${status.updatedAt}`,
    `Direct Codex launch supported: ${status.directCodexLaunchSupported ? "yes" : "no"}`,
    `Codex CLI found: ${status.codexCli.found ? "yes" : "no"}`,
    `codex exec available: ${status.codexCli.execAvailable ? "yes" : "no"}`,
    `Direct execution enabled: ${status.codexCli.directExecutionEnabled ? "yes" : "no"}`,
    `Sandbox: ${status.codexCli.sandbox}`,
    `Last exit code: ${status.codexCli.lastExitCode ?? "n/a"}`,
    `Last error: ${status.codexCli.lastError ?? "n/a"}`,
    `Message: ${status.message}`
  ];

  if (status.currentTask) {
    lines.push(
      `Project: ${status.currentTask.projectName}`,
      `Task: ${status.currentTask.taskId} - ${status.currentTask.title}`,
      `Task path: ${status.currentTask.taskPath}`,
      `Report path: ${status.currentTask.reportPath}`,
      "",
      "Instruction for Codex:",
      status.currentTask.instruction
    );
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): {
  project?: string;
  once: boolean;
  pollIntervalMs?: number;
  statusFile?: string;
  directExecution: boolean;
  codexCommand?: string;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  codexTimeoutMs?: number;
  codexDryRun: boolean;
  codexExtraArgs: string[];
  format: "text" | "json";
} {
  return {
    project: readValue(argv, "--project") ?? readValue(argv, "-p"),
    once: argv.includes("--once"),
    pollIntervalMs: readNumber(argv, "--poll-interval-ms"),
    statusFile: readValue(argv, "--status-file"),
    directExecution: argv.includes("--direct-execution"),
    codexCommand: readValue(argv, "--codex-command"),
    codexSandbox: readSandbox(argv),
    codexTimeoutMs: readNumber(argv, "--codex-timeout-ms"),
    codexDryRun: argv.includes("--codex-dry-run"),
    codexExtraArgs: readRepeatedValues(argv, "--codex-extra-arg"),
    format: readValue(argv, "--format") === "json" ? "json" : "text"
  };
}

function readValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function readNumber(argv: string[], name: string): number | undefined {
  const value = readValue(argv, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readSandbox(argv: string[]): "read-only" | "workspace-write" | "danger-full-access" | undefined {
  const value = readValue(argv, "--codex-sandbox");
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : undefined;
}

function readRepeatedValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) {
      values.push(argv[index + 1]!);
    }
  }
  return values;
}
