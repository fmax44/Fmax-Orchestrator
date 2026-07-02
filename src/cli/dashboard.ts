import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildDashboardActions,
  DashboardService,
  renderDashboardHtml,
  type DashboardActionId,
  type DashboardActionRuntimeMap,
  type DashboardSnapshot
} from "../services/dashboard.js";
import {
  loadDashboardConfig,
  type DashboardCommandConfig,
  type DashboardConfig,
  type DashboardConfigLoadResult
} from "../services/dashboardConfig.js";
import { launchDetachedProcess } from "../utils/processLaunch.js";

interface DashboardServerOptions {
  dashboardService: Pick<DashboardService, "collect">;
  loadedConfig: DashboardConfigLoadResult;
  orchestratorRoot: string;
  port: number;
  actionDependencies?: DashboardActionDependencies;
}

interface DashboardActionDependencies {
  openTarget?: (target: string, preferredAppPath?: string) => Promise<void>;
  startCommand?: (command: DashboardCommandConfig | undefined) => Promise<void>;
}

if (isMainModule()) {
  await main();
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const actionRuntime: DashboardActionRuntimeMap = {};

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${options.port}`);
      const flash = readFlashMessage(url);

      if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/health" || url.pathname === "/healthz")) {
        return sendJson(response, {
          ok: true,
          service: "dashboard",
          port: options.port,
          timestamp: new Date().toISOString()
        }, request.method === "HEAD");
      }

      if (request.method === "GET" && url.pathname === "/api/status") {
        const snapshot = await collectSnapshot(options, actionRuntime);
        return sendJson(response, snapshot);
      }

      if (request.method === "POST" && url.pathname.startsWith("/action/")) {
        return handleActionRequest(request, response, url, options, actionRuntime);
      }

      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
        if (request.method === "HEAD") {
          return sendHtml(response, "", true);
        }

        const snapshot = await collectSnapshot(options, actionRuntime);
        return sendHtml(response, renderDashboardHtml(snapshot, options.loadedConfig.config, { flash }));
      }

      return sendText(response, "Not found", 404);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return sendText(response, message, 500);
    }
  });
}

export async function handleAction(
  action: DashboardActionId,
  localConfigPath: string,
  config: DashboardConfig,
  dependencies: DashboardActionDependencies = {}
): Promise<void> {
  const open = dependencies.openTarget ?? openTarget;
  const start = dependencies.startCommand ?? startCommand;

  switch (action) {
    case "open-chatgpt":
      await open(config.apps.chatgptUrl, config.apps.browserPath);
      return;
    case "open-codex":
      await open(requireConfigured(config.apps.codexPath, "apps.codexPath is not configured."));
      return;
    case "open-vpn":
      await open(requireConfigured(config.apps.vpnPath, "apps.vpnPath is not configured."));
      return;
    case "start-mcp":
      await start(config.commands.mcpServer);
      return;
    case "start-tunnel":
      await start(config.commands.tunnel);
      return;
    case "start-codex-worker":
      await start(config.commands.codexWorker);
      return;
    case "open-config":
      await ensureLocalConfig(localConfigPath);
      await open(localConfigPath);
      return;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(renderHelpText());
    return;
  }

  const orchestratorRoot = process.cwd();
  const loadedConfig = await loadDashboardConfig(orchestratorRoot);
  const port = args.port ?? loadedConfig.config.dashboardPort;
  const server = createDashboardServer({
    dashboardService: new DashboardService(),
    loadedConfig,
    orchestratorRoot,
    port
  });

  server.listen(port, "127.0.0.1", async () => {
    const url = `http://127.0.0.1:${port}/`;
    await writePid(port);
    console.log(`Fmax-Orchestrator dashboard: ${url}`);
    console.log(`Local config: ${loadedConfig.localConfigPath}`);
    console.log("Press Ctrl+C to stop.");
    if (args.open) {
      await openTarget(url);
    }
  });

  server.on("close", async () => {
    await removePid().catch(() => undefined);
  });

  process.on("SIGINT", async () => {
    server.close();
    await removePid().catch(() => undefined);
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    server.close();
    await removePid().catch(() => undefined);
    process.exit(0);
  });
}

async function collectSnapshot(options: DashboardServerOptions, actionRuntime: DashboardActionRuntimeMap): Promise<DashboardSnapshot> {
  return options.dashboardService.collect({
    orchestratorRoot: options.orchestratorRoot,
    configPath: options.loadedConfig.localConfigPath,
    configExists: options.loadedConfig.localConfigExists,
    config: options.loadedConfig.config,
    actionRuntime
  });
}

async function handleActionRequest(
  _request: IncomingMessage,
  response: ServerResponse<IncomingMessage>,
  url: URL,
  options: DashboardServerOptions,
  actionRuntime: DashboardActionRuntimeMap
): Promise<void> {
  const action = url.pathname.replace("/action/", "") as DashboardActionId;
  const actionState = buildDashboardActions(options.loadedConfig.config).find((item) => item.id === action);
  if (!actionState) {
    return sendText(response, `Unknown action: ${action}`, 404);
  }

  if (!actionState.enabled) {
    return sendText(response, actionState.reason ?? `Action "${action}" is disabled.`, 400);
  }

  try {
    await handleAction(action, options.loadedConfig.localConfigPath, options.loadedConfig.config, options.actionDependencies);
    actionRuntime[action] = recordSuccessfulActionState(action);
  } catch (error: unknown) {
    const message = formatActionError(action, error);
    actionRuntime[action] = { state: "failed", message, updatedAt: new Date().toISOString() };
    response.statusCode = 303;
    response.setHeader("Location", `/?error=${encodeURIComponent(message)}`);
    response.end();
    return;
  }

  response.statusCode = 303;
  response.setHeader("Location", `/?ok=${encodeURIComponent(`Действие "${action}" запущено.`)}`);
  response.end();
}

function recordSuccessfulActionState(action: DashboardActionId): DashboardActionRuntimeMap[DashboardActionId] {
  const updatedAt = new Date().toISOString();
  if (isServiceAction(action)) {
    return {
      state: "starting",
      message: "Команда запущена, ожидаем подтверждение статуса.",
      updatedAt
    };
  }

  return {
    state: "idle",
    message: "Действие выполнено.",
    updatedAt
  };
}

function isServiceAction(action: DashboardActionId): boolean {
  return action === "start-tunnel" || action === "start-mcp" || action === "start-codex-worker";
}

function requireConfigured(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

async function ensureLocalConfig(localConfigPath: string): Promise<void> {
  const exists = await stat(localConfigPath).then(() => true).catch(() => false);
  if (exists) {
    return;
  }

  const examplePath = path.join(path.dirname(localConfigPath), "fmax-orchestrator.config.example.json");
  const example = await readFile(examplePath, "utf8");
  await mkdir(path.dirname(localConfigPath), { recursive: true });
  await writeFile(localConfigPath, example, "utf8");
}

async function startCommand(command: DashboardCommandConfig | undefined): Promise<void> {
  if (!command) {
    throw new Error("Command is not configured.");
  }

  await launchDetachedProcess(command);
}

async function openTarget(target: string, preferredAppPath?: string): Promise<void> {
  if (process.platform === "win32") {
    const command = preferredAppPath
      ? `Start-Process -FilePath '${preferredAppPath.replaceAll("'", "''")}' -ArgumentList '${target.replaceAll("'", "''")}'`
      : `Start-Process -FilePath '${target.replaceAll("'", "''")}'`;
    spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
    return;
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [target], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function sendHtml(response: ServerResponse<IncomingMessage>, html: string, headOnly = false): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(headOnly ? undefined : html);
}

function sendJson(response: ServerResponse<IncomingMessage>, body: unknown, headOnly = false): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(headOnly ? undefined : JSON.stringify(body, null, 2));
}

function sendText(response: ServerResponse<IncomingMessage>, body: string, statusCode: number): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

function parseArgs(argv: string[]): { port?: number; open: boolean; help: boolean } {
  return {
    port: readValue(argv, "--port") ? Number(readValue(argv, "--port")) : undefined,
    open: argv.includes("--open"),
    help: argv.includes("--help") || argv.includes("-h")
  };
}

function readValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function writePid(port: number): Promise<void> {
  const pidPath = path.join(process.cwd(), "scripts", "fmax-orchestrator-dashboard.pid");
  const content = JSON.stringify({
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
    host: os.hostname()
  }, null, 2);
  await writeFile(pidPath, `${content}\n`, "utf8");
}

async function removePid(): Promise<void> {
  const pidPath = path.join(process.cwd(), "scripts", "fmax-orchestrator-dashboard.pid");
  await stat(pidPath).then(() => import("node:fs/promises").then((fs) => fs.unlink(pidPath))).catch(() => undefined);
}

function readFlashMessage(url: URL): { kind: "ok" | "error"; text: string } | undefined {
  const error = url.searchParams.get("error")?.trim();
  if (error) {
    return { kind: "error", text: error };
  }

  const ok = url.searchParams.get("ok")?.trim();
  if (ok) {
    return { kind: "ok", text: ok };
  }

  return undefined;
}

function formatActionError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Действие "${action}" не удалось запустить: ${message}`;
}

function renderHelpText(): string {
  return [
    "Fmax-Orchestrator dashboard CLI",
    "",
    "Usage:",
    "  npm run dashboard -- [--port <number>] [--open]",
    "  npm run dashboard:open",
    "  npm run dashboard:start -- --open",
    "",
    "Options:",
    "  --port <number>  Override dashboard HTTP port.",
    "  --open           Open the dashboard in the configured browser after start.",
    "  -h, --help       Show this help message.",
    "",
    "HTTP endpoints:",
    "  GET  /",
    "  HEAD /",
    "  GET  /health",
    "  GET  /healthz",
    "  GET  /api/status"
  ].join("\n");
}

function isMainModule(): boolean {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}
