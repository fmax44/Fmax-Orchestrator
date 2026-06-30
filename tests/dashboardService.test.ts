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
  });

  it("marks tunnel online when health and ready probes pass", async () => {
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
    expect(snapshot.ips.publicIp).toBe("1.2.3.4");
    expect(snapshot.ips.city).toBe("Moscow");
    expect(snapshot.ips.country).toBe("Russia");
    expect(snapshot.actions.map((item) => item.id)).toEqual([
      "open-vpn",
      "start-tunnel",
      "start-mcp",
      "open-chatgpt",
      "open-codex",
      "open-config"
    ]);
    const html = renderDashboardHtml(snapshot, config);
    expect(html).toContain("Открыть VPN");
    expect(html).toContain("Город: Moscow");
    expect(html).toContain("Страна: Russia");
  });
});
