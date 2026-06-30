import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DashboardService, renderDashboardHtml } from "../services/dashboard.js";
import { loadDashboardConfig, type DashboardCommandConfig, type DashboardConfig } from "../services/dashboardConfig.js";

const args = parseArgs(process.argv.slice(2));
const orchestratorRoot = process.cwd();
const loaded = await loadDashboardConfig(orchestratorRoot);
const port = args.port ?? loaded.config.dashboardPort;
const dashboard = new DashboardService();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (request.method === "GET" && url.pathname === "/api/status") {
      const snapshot = await dashboard.collect({
        orchestratorRoot,
        configPath: loaded.localConfigPath,
        configExists: loaded.localConfigExists,
        config: loaded.config
      });
      return sendJson(response, snapshot);
    }

    if (request.method === "POST" && url.pathname.startsWith("/action/")) {
      await handleAction(url.pathname.replace("/action/", ""), loaded.localConfigPath, loaded.config);
      response.statusCode = 303;
      response.setHeader("Location", "/");
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const snapshot = await dashboard.collect({
        orchestratorRoot,
        configPath: loaded.localConfigPath,
        configExists: loaded.localConfigExists,
        config: loaded.config
      });
      return sendHtml(response, renderDashboardHtml(snapshot, loaded.config));
    }

    response.statusCode = 404;
    response.end("Not found");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    response.statusCode = 500;
    response.end(message);
  }
});

server.listen(port, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${port}/`;
  await writePid(port);
  console.log(`Fmax-Orchestrator dashboard: ${url}`);
  console.log(`Local config: ${loaded.localConfigPath}`);
  console.log(`Press Ctrl+C to stop.`);
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

async function handleAction(action: string, localConfigPath: string, config: DashboardConfig): Promise<void> {
  switch (action) {
    case "open-chatgpt":
      await openTarget(config.apps.chatgptUrl, config.apps.browserPath);
      return;
    case "open-codex":
      if (!config.apps.codexPath) {
        throw new Error("apps.codexPath is not configured.");
      }
      await openTarget(config.apps.codexPath);
      return;
    case "open-vpn":
      if (!config.apps.vpnPath) {
        throw new Error("apps.vpnPath is not configured.");
      }
      await openTarget(config.apps.vpnPath);
      return;
    case "start-mcp":
      await startCommand(config.commands.mcpServer);
      return;
    case "start-tunnel":
      await startCommand(config.commands.tunnel);
      return;
    case "open-config":
      await ensureLocalConfig(localConfigPath);
      await openTarget(localConfigPath);
      return;
    default:
      throw new Error(`Unknown action: ${action}`);
  }
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

  spawn(command.command, command.args ?? [], {
    cwd: command.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...command.env
    },
    detached: true,
    stdio: "ignore"
  }).unref();
}

async function openTarget(target: string, preferredAppPath?: string): Promise<void> {
  if (process.platform === "win32") {
    const command = preferredAppPath
      ? `Start-Process -FilePath '${preferredAppPath.replaceAll("'", "''")}' -ArgumentList '${target.replaceAll("'", "''")}'`
      : `Start-Process -FilePath '${target.replaceAll("'", "''")}'`;
    spawn("powershell.exe", [
      "-NoProfile",
      "-Command",
      command
    ], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [target], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function sendHtml(response: ServerResponse<IncomingMessage>, html: string): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function sendJson(response: ServerResponse<IncomingMessage>, body: unknown): void {
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body, null, 2));
}

function parseArgs(argv: string[]): { port?: number; open: boolean } {
  return {
    port: readValue(argv, "--port") ? Number(readValue(argv, "--port")) : undefined,
    open: argv.includes("--open")
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
