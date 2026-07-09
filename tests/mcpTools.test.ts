import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolHandlers, registerTools, toolNames } from "../src/mcp/tools.js";
import { buildMcpServer } from "../src/mcp/server.js";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("MCP tool registry", () => {
  it("declares the MVP tool names", () => {
    expect(toolNames).toContain("create_task");
    expect(toolNames).toContain("create_next_task");
    expect(toolNames).toContain("project_health");
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("archive_task");
    expect(toolNames).toContain("doctor");
    expect(toolNames).toContain("smoke_check");
    expect(toolNames).toContain("read_policy");
    expect(toolNames).toContain("validate_task_against_policy");
    expect(toolNames).toContain("validate_diff_against_policy");
    expect(toolNames).toContain("review_gate");
    expect(toolNames).toContain("project_status");
    expect(toolNames).toContain("relay_status");
    expect(toolNames).toContain("codex_next");
    expect(toolNames).toContain("codex_autonomous_run");
    expect(toolNames).toContain("start_codex_worker");
    expect(toolNames).toContain("codex_worker_status");
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
        decision: "Looks good.",
        force: true,
        forceReason: "MCP handler smoke test uses a minimal non-Git temp project."
      })
    ).resolves.toMatchObject({ status: "approved" });
  }, 15000);

  it("exposes relay_status and codex_next through tool handlers", async () => {
    const projectPath = await readyProject();
    const handlers = createToolHandlers();

    await expect(
      handlers.projectStatus({
        projectPath,
        includeDoctor: false
      })
    ).resolves.toMatchObject({
      recommendedAction: "create_task",
      waitingFor: "chatgpt",
      nextActor: "chatgpt"
    });

    await expect(
      handlers.relayStatus({
        projectPath,
        includeDoctor: false
      })
    ).resolves.toMatchObject({
      waitingFor: "chatgpt",
      nextActor: "chatgpt"
    });

    await expect(
      handlers.codexNext({
        projectPath
      })
    ).resolves.toMatchObject({
      waitingFor: "chatgpt"
    });

    await expect(
      handlers.codexWorkerStatus({})
    ).resolves.toMatchObject({
      runtime: {
        command: expect.stringMatching(/codex(?:\.cmd)?$/i)
      },
      statusFilePath: expect.stringContaining("fmax-orchestrator-codex-worker-status.json"),
      pidFilePath: expect.stringContaining("fmax-orchestrator-codex-worker.pid")
    });

    await expect(
      handlers.codexAutonomousRun({
        projectPath,
        dryRun: true
      })
    ).resolves.toMatchObject({
      executionState: "idle"
    });
  }, 15000);

  it("keeps codex_autonomous_run in manual mode unless direct execution is explicitly allowed", async () => {
    const projectPath = await readyProject();
    const handlers = createToolHandlers();

    await handlers.createTask({
      projectPath,
      title: "Manual Codex Desktop task",
      goal: "Verify autonomous run stays blocked by default",
      acceptanceCriteria: ["codex exec is not invoked"]
    });

    await expect(
      handlers.codexAutonomousRun({
        projectPath
      })
    ).resolves.toMatchObject({
      executionState: "blocked",
      directExecutionEnabled: false,
      nextRecommendedAction: "manual_codex_run",
      reportExists: false
    });
  }, 15000);

  it("returns a structured MCP error payload for read_report when the report is missing", async () => {
    const projectPath = await readyProject();
    const handlers = createToolHandlers();
    const registeredTools: Array<{
      name: string;
      callback: (args: { projectPath: string; taskId: string }) => Promise<{ content: Array<{ text: string }> }>;
    }> = [];
    const server = {
      registerTool(name: string, _config: unknown, callback: (args: { projectPath: string; taskId: string }) => Promise<{ content: Array<{ text: string }> }>) {
        registeredTools.push({ name, callback });
      }
    };
    registerTools(server as never, handlers);
    const tool = registeredTools.find((entry) => entry.name === "read_report");

    expect(tool).toBeDefined();

    const result = await tool.callback({ projectPath, taskId: "9999" });
    const payload = JSON.parse(result.content[0].text) as { ok: boolean; error: { message: string } };

    expect(payload.ok).toBe(false);
    expect(payload.error.message).toContain("Task not found");
  }, 15000);

  it("returns a valid MCP review_gate payload when required checks fail", async () => {
    const projectPath = await readyProject();
    const handlers = createToolHandlers();
    const task = await handlers.createTask({
      projectPath,
      title: "Review payload task",
      goal: "Verify review_gate MCP response stability",
      acceptanceCriteria: ["review_gate returns JSON text content"],
      requiredChecks: ["node -e \"process.exit(1)\""]
    }) as { taskId: string };
    await writeFile(
      path.join(projectPath, ".codex", "reports", `${task.taskId}-report.md`),
      `# Report for Task ${task.taskId}\n\nSmoke report.\n`,
      "utf8"
    );

    const registeredTools: Array<{
      name: string;
      callback: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
    }> = [];
    const server = {
      registerTool(name: string, _config: unknown, callback: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>) {
        registeredTools.push({ name, callback });
      }
    };
    registerTools(server as never, handlers);
    const tool = registeredTools.find((entry) => entry.name === "review_gate");

    expect(tool).toBeDefined();

    const result = await tool.callback({
      projectPath,
      taskId: task.taskId,
      requireReport: true,
      requireCleanForbiddenPaths: true,
      writeReport: false,
      format: "json"
    });
    const payload = JSON.parse(result.content[0].text) as { taskId: string; decision: string; errors: string[] };

    expect(payload).toMatchObject({
      taskId: task.taskId,
      decision: "BLOCKED"
    });
    expect(payload.errors).toContain("Required check failed: node -e \"process.exit(1)\"");
  }, 15000);
});

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function readyProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-ready-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  await safeExec(root, "git init");
  await safeExec(root, "git config user.email test@example.com");
  await safeExec(root, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(root, { policy: "node" });
  await safeExec(root, "git add .gitignore");
  await safeExec(root, "git commit -m ready");
  return root;
}
