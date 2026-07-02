import path from "node:path";
import { loadDashboardConfig } from "../services/dashboardConfig.js";
import { CodexAutonomousRunService } from "../services/codexAutonomousRun.js";

const args = parseArgs(process.argv.slice(2));
const orchestratorRoot = process.cwd();

try {
  const loaded = await loadDashboardConfig(orchestratorRoot);
  const service = new CodexAutonomousRunService();
  const directExecutionEnabled = loaded.config.worker.directExecution.enabled && args.directExecution;
  const result = await service.run({
    projects: loaded.config.managedProjects,
    projectPath: args.project ? path.resolve(args.project) : undefined,
    statusFilePath: loaded.config.worker.statusFilePath,
    pidFilePath: loaded.config.worker.pidFilePath,
    pollIntervalMs: args.pollIntervalMs ?? loaded.config.worker.pollIntervalMs,
    waitTimeoutMs: args.timeoutMs,
    dryRun: args.dryRun,
    localConfigExists: loaded.localConfigExists,
    directExecution: {
      ...loaded.config.worker.directExecution,
      enabled: directExecutionEnabled,
      sandbox: directExecutionEnabled ? loaded.config.worker.directExecution.sandbox : "read-only"
    }
  });

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatAutonomousRunText(result));
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function formatAutonomousRunText(result: {
  taskId?: string;
  taskPath?: string;
  reportPath?: string;
  reportExists: boolean;
  executionState: string;
  nextRecommendedAction: string;
  directExecutionEnabled: boolean;
  directExecutionReason: string;
  dryRun: boolean;
  message: string;
  plannedCommand?: string;
  changedFilesSummary: string[];
  configSource?: "local" | "default";
}): string {
  return [
    "Controlled Codex autonomous run (experimental; disabled by default):",
    `Execution state: ${result.executionState}`,
    `Direct execution enabled: ${result.directExecutionEnabled ? "yes" : "no"}`,
    `Direct execution reason: ${result.directExecutionReason}`,
    result.configSource ? `Config source: ${result.configSource}` : undefined,
    `Dry-run: ${result.dryRun ? "yes" : "no"}`,
    `Task: ${result.taskId ?? "none"}`,
    `Task path: ${result.taskPath ?? "n/a"}`,
    `Report path: ${result.reportPath ?? "n/a"}`,
    `Report exists: ${result.reportExists ? "yes" : "no"}`,
    `Next action: ${result.nextRecommendedAction}`,
    result.plannedCommand ? `Planned command: ${result.plannedCommand}` : undefined,
    `Message: ${result.message}`,
    result.changedFilesSummary.length > 0 ? "Changed files:" : undefined,
    ...result.changedFilesSummary
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function parseArgs(argv: string[]): {
  project?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  dryRun: boolean;
  format: "text" | "json";
  directExecution: boolean;
} {
  return {
    project: readValue(argv, "--project") ?? readValue(argv, "-p"),
    timeoutMs: readNumber(argv, "--timeout-ms"),
    pollIntervalMs: readNumber(argv, "--poll-interval-ms"),
    dryRun: argv.includes("--dry-run"),
    format: readValue(argv, "--format") === "json" ? "json" : "text",
    directExecution: argv.includes("--direct-execution")
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
