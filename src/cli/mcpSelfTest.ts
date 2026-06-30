import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ProjectBootstrap } from "../services/projectBootstrap.js";
import { safeExec } from "../utils/safeExec.js";

interface SelfTestResult {
  serverCommand: {
    command: string;
    args: string[];
  };
  tools: string[];
  checks: Array<{
    name: string;
    status: "pass" | "fail";
    details: string;
  }>;
  tempProjectPath: string;
  inspectedProjectPath?: string;
}

const args = parseArgs(process.argv.slice(2));

try {
  const result = await runSelfTest(args.project);
  const hasFailures = result.checks.some((check) => check.status === "fail");

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSelfTestText(result));
  }

  if (hasFailures) {
    process.exitCode = 1;
  }
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

async function runSelfTest(inspectedProjectPath?: string): Promise<SelfTestResult> {
  const serverCommand = await resolveServerCommand();
  const projectPath = await readyProject();
  const client = new Client({
    name: "chatgpt-codex-mcp-self-test",
    version: "0.1.0"
  });
  const transport = new StdioClientTransport({
    command: serverCommand.command,
    args: serverCommand.args,
    cwd: process.cwd(),
    stderr: "pipe"
  });
  const checks: SelfTestResult["checks"] = [];

  try {
    await client.connect(transport);
    checks.push(pass("connect", "Connected to local MCP server over stdio."));

    const toolsResult = await client.listTools();
    const tools = toolsResult.tools.map((tool) => tool.name).sort();
    const requiredTools = [
      "create_task",
      "get_task_status",
      "read_report",
      "inspect_diff",
      "run_tests",
      "review_gate",
      "approve_task",
      "reject_task",
      "project_status",
      "relay_status",
      "codex_next"
    ];
    const missing = requiredTools.filter((tool) => !tools.includes(tool));
    checks.push(
      missing.length === 0
        ? pass("list tools", `All required tools are present (${requiredTools.join(", ")}).`)
        : fail("list tools", `Missing tools: ${missing.join(", ")}`)
    );

    const projectStatus = await callToolJson<{
      recommendedAction: string;
      waitingFor: string;
      nextActor: string;
    }>(client, "project_status", {
      projectPath,
      includeDoctor: false,
      includeReview: true
    });
    checks.push(
      projectStatus.recommendedAction === "create_task" && projectStatus.waitingFor === "chatgpt" && projectStatus.nextActor === "chatgpt"
        ? pass("project_status", `Recommended action: ${projectStatus.recommendedAction}.`)
        : fail("project_status", JSON.stringify(projectStatus))
    );

    if (inspectedProjectPath) {
      const requestedProjectStatus = await callToolJson<{
        projectName: string;
        recommendedAction: string;
        waitingFor: string;
        nextActor: string;
      }>(client, "project_status", {
        projectPath: inspectedProjectPath,
        includeDoctor: true,
        includeReview: true
      });
      checks.push(
        requestedProjectStatus.projectName.length > 0
          ? pass(
              "project_status requested project",
              `${requestedProjectStatus.projectName}: ${requestedProjectStatus.recommendedAction}, waitingFor=${requestedProjectStatus.waitingFor}, nextActor=${requestedProjectStatus.nextActor}.`
            )
          : fail("project_status requested project", JSON.stringify(requestedProjectStatus))
      );
    }

    const createTask = await callToolJson<{ taskId: string; status: string }>(client, "create_task", {
      projectPath,
      title: "MCP self-test task",
      goal: "Verify MCP round-trip",
      acceptanceCriteria: ["Task exists in queue"]
    });
    checks.push(
      createTask.taskId === "0001" && createTask.status === "pending"
        ? pass("create_task", `Created task ${createTask.taskId}.`)
        : fail("create_task", JSON.stringify(createTask))
    );

    const codexNext = await callToolJson<{
      waitingFor: string;
      nextAction: string;
      task?: { id: string };
    }>(client, "codex_next", {
      projectPath
    });
    checks.push(
      codexNext.task?.id === "0001" && codexNext.waitingFor === "codex"
        ? pass("codex_next", codexNext.nextAction)
        : fail("codex_next", JSON.stringify(codexNext))
    );

    const reportPath = path.join(projectPath, ".codex", "reports", "0001-report.md");
    await writeFile(reportPath, "# Report for Task 0001\n\nSelf-test report.\n", "utf8");

    const relayStatus = await callToolJson<{
      waitingFor: string;
      nextActor: string;
      currentTask?: { id: string; reportExists: boolean };
    }>(client, "relay_status", {
      projectPath,
      includeDoctor: false,
      includeReview: true
    });
    checks.push(
      relayStatus.currentTask?.id === "0001" && relayStatus.currentTask.reportExists && relayStatus.waitingFor === "review" && relayStatus.nextActor === "chatgpt"
        ? pass("relay_status", "Report was detected and relay moved to ChatGPT review.")
        : fail("relay_status", JSON.stringify(relayStatus))
    );

    const readReport = await callToolJson<{ taskId: string; reportPath: string; markdown: string }>(client, "read_report", {
      projectPath,
      taskId: "0001"
    });
    checks.push(
      readReport.taskId === "0001" && readReport.reportPath.endsWith("0001-report.md") && readReport.markdown.includes("Self-test report")
        ? pass("read_report", "Created report is readable through MCP.")
        : fail("read_report", JSON.stringify(readReport))
    );

    return {
      serverCommand,
      tools,
      checks,
      tempProjectPath: projectPath,
      inspectedProjectPath
    };
  } finally {
    await transport.close().catch(() => undefined);
    await rm(projectPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function readyProject(): Promise<string> {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "chatgpt-codex-mcp-self-test-"));
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(projectPath, { policy: "node" });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function resolveServerCommand(): Promise<{ command: string; args: string[] }> {
  const root = process.cwd();
  const distEntry = path.join(root, "dist", "index.js");
  const tsxEntry = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

  const distExists = await fileExists(distEntry);
  if (distExists) {
    return {
      command: process.execPath,
      args: [distEntry]
    };
  }

  return {
    command: process.execPath,
    args: [tsxEntry, path.join(root, "src", "index.ts")]
  };
}

async function callToolJson<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool(
    {
      name,
      arguments: args
    },
    CallToolResultSchema
  ) as CallToolResult;

  const text = result.content.find((item) => item.type === "text");
  if (!text) {
    throw new Error(`Tool ${name} did not return text content.`);
  }

  return JSON.parse(text.text) as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  return import("node:fs/promises")
    .then(({ stat }) => stat(filePath).then(() => true).catch(() => false));
}

function pass(name: string, details: string): SelfTestResult["checks"][number] {
  return { name, status: "pass", details };
}

function fail(name: string, details: string): SelfTestResult["checks"][number] {
  return { name, status: "fail", details };
}

function formatSelfTestText(result: SelfTestResult): string {
  const lines = [
    "MCP self-test:",
    "",
    `Server command: ${result.serverCommand.command} ${result.serverCommand.args.join(" ")}`,
    `Temporary project: ${result.tempProjectPath}`,
    ...(result.inspectedProjectPath ? [`Requested project: ${result.inspectedProjectPath}`] : []),
    "",
    "Checks:"
  ];

  lines.push(...result.checks.map((check) => `[${check.status === "pass" ? "PASS" : "FAIL"}] ${check.name} - ${check.details}`));
  lines.push("", `Tools detected: ${result.tools.join(", ")}`);
  return lines.join("\n");
}

function parseArgs(argv: string[]): { format: "text" | "json"; project?: string } {
  return {
    format: readValue(argv, "--format") === "json" ? "json" : "text",
    project: readValue(argv, "--project") ?? readValue(argv, "-p")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
