import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("dashboard CLI source", () => {
  it("contains help text for dashboard commands and endpoints", async () => {
    const filePath = path.join(process.cwd(), "src", "cli", "dashboard.ts");
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("Fmax-Orchestrator dashboard CLI");
    expect(content).toContain("npm run dashboard -- [--port <number>] [--open]");
    expect(content).toContain("GET  /healthz");
    expect(content).toContain("HEAD /");
  });

  it("handles health endpoints and dashboard root HEAD requests", async () => {
    const filePath = path.join(process.cwd(), "src", "cli", "dashboard.ts");
    const content = await readFile(filePath, "utf8");

    expect(content).toContain('url.pathname === "/health"');
    expect(content).toContain('url.pathname === "/healthz"');
    expect(content).toContain('request.method === "HEAD"');
    expect(content).toContain('url.pathname === "/"');
  });
});
