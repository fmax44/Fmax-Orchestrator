import { describe, expect, it } from "vitest";
import { DashboardService, renderDashboardHtml } from "../src/services/dashboard.js";
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
    expect(snapshot.components.codexWorker.meta).toContain("Codex CLI: не найден");
  });

  it("renders public IP, city, country, UTF-8 Russian text, and Codex Worker status", async () => {
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
    expect(snapshot.components.codexWorker.state).toBe("degraded");
    expect(snapshot.ips.publicIp).toBe("1.2.3.4");
    expect(snapshot.ips.city).toBe("Moscow");
    expect(snapshot.ips.country).toBe("Russia");
    expect(snapshot.actions.map((item) => item.id)).toEqual([
      "open-vpn",
      "start-tunnel",
      "start-mcp",
      "open-chatgpt",
      "open-codex",
      "open-config",
      "start-codex-worker"
    ]);

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
    expect(html).toContain("Codex CLI");
    expect(html).toContain("workspace-write");
    expect(html).toContain("Действие &quot;start-mcp&quot; не удалось запустить: example error");
  });
});
