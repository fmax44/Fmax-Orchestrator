import { describe, expect, it } from "vitest";
import { DashboardService, buildDashboardActions, renderDashboardHtml } from "../src/services/dashboard.js";
import { createDefaultDashboardConfig } from "../src/services/dashboardConfig.js";

describe("DashboardService", () => {
  it("returns unavailable public IP when lookup fails", async () => {
    const service = new DashboardService({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      projectStatusService: {
        check: async ({ projectPath }) => ({
          projectPath,
          projectName: "demo",
          git: { isRepo: true, status: "clean", changedFiles: [] },
          policy: { exists: true, strictReviewGate: true },
          doctor: { result: "READY", warnings: [] },
          tasks: { total: 0, pending: 0, reported: 0, approved: 0, rejected: 0, archived: 0 },
          reports: {},
          recommendedAction: "create_task",
          waitingFor: "chatgpt",
          nextActor: "chatgpt",
          nextAction: "Create task",
          warnings: [],
          errors: []
        })
      },
      codexWorkerService: {
        readStatus: async () => undefined,
        inspectEnvironment: async () => ({
          command: "codex",
          checked: false,
          found: false,
          execAvailable: false,
          directExecutionEnabled: false,
          sandbox: "read-only",
          lastError: "Command not found: codex"
        })
      }
    });
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");

    const snapshot = await service.collect({
      orchestratorRoot: "D:/projects/chatgpt-codex-mcp",
      configPath: "D:/projects/chatgpt-codex-mcp/scripts/fmax-orchestrator.config.local.json",
      configExists: false,
      config
    });

    expect(snapshot.ips.publicIp).toBeUndefined();
    expect(snapshot.ips.publicIpStatus).toBe("unavailable");
    expect(snapshot.ips.city).toBeUndefined();
    expect(snapshot.ips.country).toBeUndefined();
    expect(snapshot.ips.geoStatus).toBe("unavailable");
    expect(snapshot.projects[0]?.recommendedAction).toBe("create_task");
    expect(snapshot.components.codexWorker.state).toBe("manual");
    expect(snapshot.components.codexWorker.details).toContain("Manual Codex Desktop mode");
    expect(snapshot.components.codexWorker.meta).toContain("Codex CLI: не проверялся");
  });

  it("renders UTF-8 Russian text and exposes running state for active worker", async () => {
    const service = new DashboardService({
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("api.ipify.org")) {
          return {
            ok: true,
            json: async () => ({ ip: "1.2.3.4" })
          } as Response;
        }

        if (url.includes("ipwho.is")) {
          return {
            ok: true,
            json: async () => ({ success: true, city: "Moscow", country: "Russia" })
          } as Response;
        }

        return {
          ok: true,
          json: async () => ({})
        } as Response;
      },
      projectStatusService: {
        check: async ({ projectPath }) => ({
          projectPath,
          projectName: "demo",
          git: { isRepo: true, status: "clean", changedFiles: [] },
          policy: { exists: true, strictReviewGate: true },
          doctor: { result: "READY", warnings: [] },
          tasks: { total: 0, pending: 0, reported: 0, approved: 0, rejected: 0, archived: 0 },
          reports: {},
          recommendedAction: "create_task",
          waitingFor: "chatgpt",
          nextActor: "chatgpt",
          nextAction: "Create task",
          warnings: [],
          errors: []
        })
      },
      codexWorkerService: {
        readStatus: async () => ({
          state: "waiting_for_codex",
          updatedAt: "2026-06-30T07:00:00.000Z",
          pollIntervalMs: 5000,
          message: "Waiting for Codex report for task 0003.",
          currentTask: {
            projectName: "demo",
            projectPath: "D:/projects/demo",
            taskId: "0003",
            title: "Add worker tests",
            status: "pending",
            taskPath: ".codex/tasks/0003-task.md",
            reportPath: ".codex/reports/0003-report.md",
            reportExists: false,
            instruction: "1. Open task file .codex/tasks/0003-task.md."
          },
          lastReportStatus: "missing",
          directCodexLaunchSupported: false,
          limitations: ["no direct launch"],
          codexCli: {
            command: "codex",
            commandPath: "C:/Codex/codex.exe",
            found: true,
            execAvailable: true,
            directExecutionEnabled: true,
            sandbox: "workspace-write",
            lastExitCode: 0
          },
          host: "test-host",
          pid: 1234
        }),
        inspectEnvironment: async () => ({
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "workspace-write"
        })
      }
    });
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");

    const snapshot = await service.collect({
      orchestratorRoot: "D:/projects/chatgpt-codex-mcp",
      configPath: "D:/projects/chatgpt-codex-mcp/scripts/fmax-orchestrator.config.local.json",
      configExists: true,
      config
    });

    expect(snapshot.components.tunnel.state).toBe("online");
    expect(snapshot.actions.find((item) => item.id === "start-codex-worker")).toMatchObject({
      state: "running",
      statusText: "работает"
    });

    const html = renderDashboardHtml(snapshot, config, {
      flash: {
        kind: "error",
        text: "Действие \"start-mcp\" не удалось запустить: example error"
      }
    });

    expect(html).toContain("Открыть VPN");
    expect(html).toContain("Город: Moscow");
    expect(html).toContain("Страна: Russia");
    expect(html).toContain("Codex Worker");
    expect(html).toContain("Последняя найденная задача");
    expect(html).toContain("Workspace-write".toLowerCase());
    expect(html).toContain("работает");
    expect(html).toContain("Действие &quot;start-mcp&quot; не удалось запустить: example error");
  });

  it("does not render a huge raw Codex Worker last error in the dashboard card", async () => {
    const rawSessionLog = [
      "UNIQUE_RAW_CODEX_SESSION_LOG_START",
      "OpenAI Codex session prompt/stdout/stderr",
      "x".repeat(2_000),
      "UNIQUE_RAW_CODEX_SESSION_LOG_END"
    ].join("\n");
    const service = new DashboardService({
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }) as Response,
      projectStatusService: {
        check: async ({ projectPath }) => ({
          projectPath,
          projectName: "demo",
          git: { isRepo: true, status: "clean", changedFiles: [] },
          policy: { exists: true, strictReviewGate: true },
          doctor: { result: "READY", warnings: [] },
          tasks: { total: 0, pending: 0, reported: 0, approved: 0, rejected: 0, archived: 0 },
          reports: {},
          recommendedAction: "create_task",
          waitingFor: "chatgpt",
          nextActor: "chatgpt",
          nextAction: "Create task",
          warnings: [],
          errors: []
        })
      },
      codexWorkerService: {
        readStatus: async () => ({
          state: "error",
          updatedAt: "2026-06-30T07:00:00.000Z",
          pollIntervalMs: 5000,
          message: "Codex execution failed.",
          lastReportStatus: "missing",
          directCodexLaunchSupported: false,
          limitations: [],
          codexCli: {
            command: "codex",
            found: true,
            execAvailable: true,
            directExecutionEnabled: true,
            sandbox: "workspace-write",
            lastExitCode: 1,
            lastError: rawSessionLog
          },
          host: "test-host",
          pid: 1234
        }),
        inspectEnvironment: async () => ({
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "workspace-write"
        })
      }
    });
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");

    const snapshot = await service.collect({
      orchestratorRoot: "D:/projects/chatgpt-codex-mcp",
      configPath: "D:/projects/chatgpt-codex-mcp/scripts/fmax-orchestrator.config.local.json",
      configExists: true,
      config
    });
    const html = renderDashboardHtml(snapshot, config);

    expect(html).toContain("Last error summary");
    expect(html).toContain("Last exit code: 1");
    expect(html).toContain("Captured Codex session log is available in the worker status file.");
    expect(html).not.toContain("UNIQUE_RAW_CODEX_SESSION_LOG_START");
    expect(html).not.toContain("UNIQUE_RAW_CODEX_SESSION_LOG_END");
    expect(html).not.toContain("x".repeat(2_000));
  });

  it("shows manual Codex Desktop mode instead of failed/running worker state when direct execution is disabled", async () => {
    const service = new DashboardService({
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }) as Response,
      projectStatusService: {
        check: async ({ projectPath }) => ({
          projectPath,
          projectName: "demo",
          git: { isRepo: true, status: "clean", changedFiles: [] },
          policy: { exists: true, strictReviewGate: true },
          doctor: { result: "READY", warnings: [] },
          tasks: { total: 1, pending: 1, reported: 0, approved: 0, rejected: 0, archived: 0 },
          reports: {},
          recommendedAction: "wait_for_codex_or_request_report",
          waitingFor: "codex",
          nextActor: "codex",
          nextAction: "Open Codex Desktop and execute task 0007.",
          warnings: [],
          errors: []
        })
      },
      codexWorkerService: {
        readStatus: async () => ({
          state: "waiting_for_codex",
          updatedAt: "2026-07-02T08:00:00.000Z",
          pollIntervalMs: 5000,
          message: "manual Codex Desktop mode: waiting for report.",
          currentTask: {
            projectName: "demo",
            projectPath: "D:/projects/demo",
            taskId: "0007",
            title: "Manual dashboard task",
            status: "pending",
            taskPath: ".codex/tasks/0007-task.md",
            reportPath: ".codex/reports/0007-report.md",
            reportExists: false,
            instruction: "Open task file .codex/tasks/0007-task.md."
          },
          lastReportStatus: "missing",
          directCodexLaunchSupported: false,
          limitations: [],
          codexCli: {
            command: "codex",
            checked: false,
            found: false,
            execAvailable: false,
            directExecutionEnabled: false,
            sandbox: "read-only",
            lastError: "manual Codex Desktop mode"
          },
          host: "test-host",
          pid: 1234
        }),
        inspectEnvironment: async () => ({
          command: "codex",
          checked: false,
          found: false,
          execAvailable: false,
          directExecutionEnabled: false,
          sandbox: "read-only"
        })
      }
    });
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");

    const snapshot = await service.collect({
      orchestratorRoot: "D:/projects/chatgpt-codex-mcp",
      configPath: "D:/projects/chatgpt-codex-mcp/scripts/fmax-orchestrator.config.local.json",
      configExists: true,
      config
    });
    const workerAction = snapshot.actions.find((item) => item.id === "start-codex-worker");

    expect(snapshot.components.codexWorker.state).toBe("manual");
    expect(workerAction).toMatchObject({
      state: "idle",
      statusText: "не запущено"
    });
    expect(renderDashboardHtml(snapshot, config)).toContain("Manual Codex Desktop mode");
  });

  it("builds idle, starting, running, failed, and disabled action states", () => {
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");
    config.commands.tunnel = undefined;

    const actions = buildDashboardActions(config, {
      mcpServer: { name: "MCP", state: "manual", details: "manual", actionState: "idle" },
      tunnel: { name: "Tunnel", state: "offline", details: "offline", actionState: "idle" },
      codexWorker: { name: "Codex Worker", state: "offline", details: "worker failed", actionState: "failed" }
    }, {
      "start-mcp": {
        state: "starting",
        message: "Команда запущена, ожидаем подтверждение статуса.",
        updatedAt: new Date().toISOString()
      }
    });

    expect(actions.find((item) => item.id === "start-tunnel")).toMatchObject({
      state: "disabled",
      statusText: "не настроено"
    });
    expect(actions.find((item) => item.id === "start-mcp")).toMatchObject({
      state: "starting",
      statusText: "запуск..."
    });
    expect(actions.find((item) => item.id === "start-codex-worker")).toMatchObject({
      state: "failed",
      statusText: "ошибка"
    });
    expect(actions.find((item) => item.id === "open-chatgpt")).toMatchObject({
      state: "idle",
      statusText: "не запущено"
    });
  });
  it("renders visual action state classes on dashboard buttons", () => {
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");
    config.apps.vpnPath = "C:/VPN/VPN.exe";
    config.apps.codexPath = "C:/Codex/Codex.exe";
    config.commands.tunnel = { label: "Start tunnel", command: "tunnel.cmd" };
    config.health.mcpHealthUrl = "http://127.0.0.1:47821/healthz";

    const actions = buildDashboardActions(config, {
      mcpServer: { name: "MCP", state: "offline", details: "health failed", actionState: "failed" },
      tunnel: { name: "Tunnel", state: "degraded", details: "readyz not ready", actionState: "starting" },
      codexWorker: { name: "Codex Worker", state: "degraded", details: "waiting", actionState: "running" }
    });

    const html = renderDashboardHtml({
      generatedAt: "2026-07-02T00:00:00.000Z",
      orchestratorRoot: "D:/projects/chatgpt-codex-mcp",
      configPath: "D:/projects/chatgpt-codex-mcp/scripts/fmax-orchestrator.config.local.json",
      configExists: true,
      components: {
        mcpServer: { name: "MCP", state: "offline", details: "health failed" },
        tunnel: { name: "Tunnel", state: "degraded", details: "readyz not ready" },
        codexWorker: { name: "Codex Worker", state: "degraded", details: "waiting" }
      },
      ips: {
        local: ["127.0.0.1"],
        publicIpStatus: "unavailable",
        publicIpDetails: "unavailable",
        geoStatus: "unavailable",
        geoDetails: "unavailable"
      },
      projects: [],
      actions
    }, config);

    expect(html).toContain("action-button idle");
    expect(html).toContain("action-button starting");
    expect(html).toContain("action-button running");
    expect(html).toContain("action-button failed");
  });
});
