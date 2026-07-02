import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultDashboardConfig, loadDashboardConfig } from "../src/services/dashboardConfig.js";

describe("dashboardConfig", () => {
  it("provides a default config with managed projects", () => {
    const config = createDefaultDashboardConfig("D:/projects/chatgpt-codex-mcp");

    expect(config.dashboardPort).toBe(47821);
    expect(config.managedProjects.length).toBeGreaterThanOrEqual(2);
    expect(config.commands.mcpServer?.label).toBe("Start MCP server");
    expect(config.publicIpGeoLookupUrlTemplate).toContain("{ip}");
    expect(config.worker.directExecution.enabled).toBe(false);
    expect(config.worker.directExecution.sandbox).toBe("read-only");
  });

  it("merges a local override config", async () => {
    const root = path.join(os.tmpdir(), `dashboard-config-${crypto.randomUUID()}`);
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "fmax-orchestrator.config.local.json"), JSON.stringify({
      dashboardPort: 49000,
      apps: {
        codexPath: "C:/Codex/Codex.exe"
      },
      managedProjects: [
        {
          name: "demo",
          path: "D:/projects/demo"
        }
      ]
    }), "utf8");

    const loaded = await loadDashboardConfig(root);

    expect(loaded.config.dashboardPort).toBe(49000);
    expect(loaded.config.apps.codexPath).toBe("C:/Codex/Codex.exe");
    expect(loaded.config.managedProjects).toHaveLength(1);
    expect(loaded.localConfigExists).toBe(true);
  });

  it("preserves nested worker.directExecution defaults when a local override changes one field", async () => {
    const root = path.join(os.tmpdir(), `dashboard-config-${crypto.randomUUID()}`);
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await writeFile(path.join(root, "scripts", "fmax-orchestrator.config.local.json"), JSON.stringify({
      worker: {
        directExecution: {
          enabled: true
        }
      }
    }), "utf8");

    const loaded = await loadDashboardConfig(root);

    expect(loaded.config.worker.directExecution.enabled).toBe(true);
    expect(loaded.config.worker.directExecution.command).toBe("codex");
    expect(loaded.config.worker.directExecution.sandbox).toBe("read-only");
    expect(loaded.config.worker.directExecution.timeoutMs).toBe(1_200_000);
  });
});
