import { afterEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { createDashboardServer, handleAction } from "../src/cli/dashboard.js";
import { buildDashboardActions } from "../src/services/dashboard.js";
import { createDefaultDashboardConfig, type DashboardConfigLoadResult } from "../src/services/dashboardConfig.js";

describe("dashboard CLI server", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    servers.length = 0;
  });

  it("serves GET /, HEAD /, /health, /healthz, and /api/status", async () => {
    const loadedConfig = createLoadedConfig();
    const baseUrl = await startTestServer(servers, {
      loadedConfig,
      dashboardService: {
        collect: async (options) => createSnapshot(loadedConfig, options.actionRuntime)
      }
    });

    const root = await fetch(`${baseUrl}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toContain("text/html; charset=utf-8");
    expect(await root.text()).toContain("Fmax-Orchestrator Dashboard");

    const head = await fetch(`${baseUrl}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("text/html; charset=utf-8");

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: "dashboard" });

    const healthz = await fetch(`${baseUrl}/healthz`);
    expect(healthz.status).toBe(200);
    expect(await healthz.json()).toMatchObject({ ok: true, service: "dashboard" });

    const status = await fetch(`${baseUrl}/api/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ generatedAt: "2026-07-02T04:30:00.000Z" });
  });

  it("returns 303 for configured actions and 400 for disabled optional actions", async () => {
    const loadedConfig = createLoadedConfig();
    const startedCommands: string[] = [];
    const openedTargets: string[] = [];
    const baseUrl = await startTestServer(servers, {
      actionDependencies: {
        openTarget: async (target) => {
          openedTargets.push(target);
        },
        startCommand: async (command) => {
          startedCommands.push([command?.command, ...(command?.args ?? [])].join(" "));
        }
      },
      loadedConfig,
      dashboardService: {
        collect: async (options) => createSnapshot(loadedConfig, options.actionRuntime)
      }
    });

    const startMcp = await fetch(`${baseUrl}/action/start-mcp`, {
      method: "POST",
      redirect: "manual"
    });
    expect(startMcp.status).toBe(303);
    expect(startMcp.headers.get("location")).toContain("/?ok=");
    expect(startedCommands[0]).toBe(`${process.execPath} ${path.join(path.resolve("D:/projects/chatgpt-codex-mcp"), "dist", "index.js")}`);

    const openChatgpt = await fetch(`${baseUrl}/action/open-chatgpt`, {
      method: "POST",
      redirect: "manual"
    });
    expect(openChatgpt.status).toBe(303);
    expect(openedTargets).toContain("https://chatgpt.com/");

    const openVpn = await fetch(`${baseUrl}/action/open-vpn`, {
      method: "POST",
      redirect: "manual"
    });
    expect(openVpn.status).toBe(400);
    expect(await openVpn.text()).toContain("apps.vpnPath");
  });

  it("reflects action runtime states in /api/status after POST actions", async () => {
    const loadedConfig = createLoadedConfig();
    const baseUrl = await startTestServer(servers, {
      actionDependencies: {
        openTarget: async () => undefined,
        startCommand: async () => undefined
      },
      loadedConfig,
      dashboardService: {
        collect: async (options) => createSnapshot(loadedConfig, options.actionRuntime)
      }
    });

    await fetch(`${baseUrl}/action/start-mcp`, {
      method: "POST",
      redirect: "manual"
    });
    await fetch(`${baseUrl}/action/open-chatgpt`, {
      method: "POST",
      redirect: "manual"
    });

    const status = await fetch(`${baseUrl}/api/status`);
    const snapshot = await status.json() as { actions: Array<{ id: string; state: string; statusText: string; details?: string }> };

    expect(snapshot.actions.find((item) => item.id === "start-mcp")).toMatchObject({
      state: "starting",
      statusText: "запуск..."
    });
    expect(snapshot.actions.find((item) => item.id === "open-chatgpt")).toMatchObject({
      state: "idle",
      statusText: "не запущено",
      details: "Действие выполнено."
    });
  });

  it("serves predictable HTTP responses for every dashboard action", async () => {
    const loadedConfig = await createLoadedConfigWithLocalFiles();
    loadedConfig.config.apps.codexPath = "C:/Codex/Codex.exe";
    loadedConfig.config.apps.vpnPath = "C:/VPN/VPN.exe";
    loadedConfig.config.commands.tunnel = {
      label: "Start tunnel",
      command: "tunnel.cmd",
      args: ["start"]
    };

    const startedCommands: string[] = [];
    const openedTargets: string[] = [];
    const baseUrl = await startTestServer(servers, {
      actionDependencies: {
        openTarget: async (target) => {
          openedTargets.push(target);
        },
        startCommand: async (command) => {
          startedCommands.push([command?.command, ...(command?.args ?? [])].join(" "));
        }
      },
      loadedConfig,
      dashboardService: {
        collect: async (options) => createSnapshot(loadedConfig, options.actionRuntime)
      }
    });

    const expected = [
      "open-vpn",
      "start-tunnel",
      "start-mcp",
      "open-chatgpt",
      "open-codex",
      "open-config",
      "start-codex-worker"
    ] as const;

    for (const action of expected) {
      const response = await fetch(`${baseUrl}/action/${action}`, {
        method: "POST",
        redirect: "manual"
      });

      expect(response.status, action).toBe(303);
      expect(response.headers.get("location"), action).toContain("/?ok=");
    }

    expect(openedTargets).toEqual([
      "C:/VPN/VPN.exe",
      "https://chatgpt.com/",
      "C:/Codex/Codex.exe",
      loadedConfig.localConfigPath
    ]);
    expect(startedCommands).toEqual([
      "tunnel.cmd start",
      `${process.execPath} ${path.join(path.dirname(loadedConfig.localConfigPath), "..", "dist", "index.js")}`,
      "npm.cmd run codex:worker"
    ]);
  });

  it("exposes handleAction for unit-level button behavior checks", async () => {
    const loadedConfig = createLoadedConfig();
    const openedTargets: string[] = [];

    await handleAction("open-chatgpt", loadedConfig.localConfigPath, loadedConfig.config, {
      openTarget: async (target) => {
        openedTargets.push(target);
      }
    });

    expect(openedTargets).toEqual(["https://chatgpt.com/"]);
    await expect(handleAction("open-vpn", loadedConfig.localConfigPath, loadedConfig.config)).rejects.toThrow("apps.vpnPath");
  });
});

function createLoadedConfig(): DashboardConfigLoadResult {
  const orchestratorRoot = path.resolve("D:/projects/chatgpt-codex-mcp");
  return {
    config: createDefaultDashboardConfig(orchestratorRoot),
    exampleConfigPath: path.join(orchestratorRoot, "scripts", "fmax-orchestrator.config.example.json"),
    localConfigPath: path.join(orchestratorRoot, "scripts", "fmax-orchestrator.config.local.json"),
    localConfigExists: false
  };
}

async function createLoadedConfigWithLocalFiles(): Promise<DashboardConfigLoadResult> {
  const orchestratorRoot = path.join(os.tmpdir(), `dashboard-cli-${crypto.randomUUID()}`);
  const scriptsPath = path.join(orchestratorRoot, "scripts");
  await mkdir(scriptsPath, { recursive: true });
  await writeFile(path.join(scriptsPath, "fmax-orchestrator.config.example.json"), "{}\n", "utf8");

  return {
    config: createDefaultDashboardConfig(orchestratorRoot),
    exampleConfigPath: path.join(scriptsPath, "fmax-orchestrator.config.example.json"),
    localConfigPath: path.join(scriptsPath, "fmax-orchestrator.config.local.json"),
    localConfigExists: false
  };
}

function createSnapshot(loadedConfig: DashboardConfigLoadResult, actionRuntime?: Parameters<typeof buildDashboardActions>[2]) {
  const components = {
    mcpServer: { name: "MCP", state: "manual", details: "manual", actionState: "idle" as const },
    tunnel: { name: "Tunnel", state: "offline", details: "offline", actionState: "idle" as const },
    codexWorker: { name: "Codex Worker", state: "manual", details: "manual", actionState: "idle" as const }
  };

  return {
    generatedAt: "2026-07-02T04:30:00.000Z",
    orchestratorRoot: loadedConfig.config.managedProjects[0]?.path ?? "D:/projects/chatgpt-codex-mcp",
    configPath: loadedConfig.localConfigPath,
    configExists: false,
    components,
    ips: {
      local: ["127.0.0.1"],
      publicIpStatus: "unavailable" as const,
      publicIpDetails: "unavailable",
      geoStatus: "unavailable" as const,
      geoDetails: "unavailable"
    },
    projects: [],
    actions: buildDashboardActions(loadedConfig.config, components, actionRuntime)
  };
}

async function startTestServer(
  servers: Server[],
  options: {
    actionDependencies?: Parameters<typeof createDashboardServer>[0]["actionDependencies"];
    dashboardService: { collect: (options: { actionRuntime?: Parameters<typeof buildDashboardActions>[2] }) => Promise<unknown> };
    loadedConfig: DashboardConfigLoadResult;
  }
): Promise<string> {
  const server = createDashboardServer({
    actionDependencies: options.actionDependencies,
    dashboardService: options.dashboardService as never,
    loadedConfig: options.loadedConfig,
    orchestratorRoot: options.loadedConfig.config.managedProjects[0]?.path ?? "D:/projects/chatgpt-codex-mcp",
    port: 0
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get dashboard test server address.");
  }

  return `http://127.0.0.1:${address.port}`;
}
