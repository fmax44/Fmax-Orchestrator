import { describe, expect, it } from "vitest";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolHandlers, toolNames } from "../src/mcp/tools.js";
import { buildMcpServer } from "../src/mcp/server.js";

describe("MCP tool registry", () => {
  it("declares the MVP tool names", () => {
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("create_next_task");
    expect(toolNames).toContain("project_health");
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("archive_task");
    expect(toolNames).toContain("doctor");
    expect(toolNames).toContain("smoke_check");
  });

  it("builds the MCP server", () => {
    expect(buildMcpServer().isConnected()).toBe(false);
  });

  it("creates and approves a task through tool handlers", async () => {
    const projectPath = await tempProject();
    const handlers = createToolHandlers();

    await expect(
      handlers.createTask({
        projectPath,
        title: "Tool task",
        goal: "Exercise handlers",
        acceptanceCriteria: ["Task exists"]
      })
    ).resolves.toMatchObject({ taskId: "0001", status: "pending" });

    await expect(
      handlers.approveTask({
        projectPath,
        taskId: "0001",
        decision: "Looks good."
      })
    ).resolves.toMatchObject({ task: { status: "approved" } });
  });
});

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}
