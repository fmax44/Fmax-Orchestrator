import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TaskStore } from "../services/taskStore.js";
import { GitService, type DiffMode } from "../services/gitService.js";
import { TestRunner } from "../services/testRunner.js";
import { ArchitectLog } from "../services/architectLog.js";
import { ProjectHealthService } from "../services/projectHealth.js";
import { taskStatuses, type TaskStatus } from "../domain/status.js";

export const toolNames = [
  "create_task",
  "get_task_status",
  "read_report",
  "inspect_diff",
  "run_tests",
  "approve_task",
  "reject_task",
  "create_next_task",
  "project_health",
  "list_tasks",
  "archive_task"
] as const;

const projectPathSchema = z.string().min(1).describe("Absolute path to the managed local project.");
const stringListSchema = z.array(z.string()).default([]);

export interface ToolHandlers {
  createTask(input: {
    projectPath: string;
    title: string;
    goal: string;
    context?: string;
    scope?: string[];
    outOfScope?: string[];
    filesAllowed?: string[];
    acceptanceCriteria?: string[];
    requiredChecks?: string[];
    notes?: string;
  }): Promise<unknown>;
  getTaskStatus(input: { projectPath: string; taskId?: string }): Promise<unknown>;
  readReport(input: { projectPath: string; taskId: string }): Promise<unknown>;
  inspectDiff(input: { projectPath: string; mode?: DiffMode }): Promise<unknown>;
  runTests(input: { projectPath: string; commands: string[]; timeoutMs?: number }): Promise<unknown>;
  approveTask(input: { projectPath: string; taskId: string; decision: string }): Promise<unknown>;
  rejectTask(input: { projectPath: string; taskId: string; reason: string; requiredFixes: string[] }): Promise<unknown>;
  projectHealth(input: { projectPath: string }): Promise<unknown>;
  listTasks(input: { projectPath: string; status?: TaskStatus }): Promise<unknown>;
  archiveTask(input: { projectPath: string; taskId: string; reason: string }): Promise<unknown>;
  createNextTask(input: {
    projectPath: string;
    previousTaskId: string;
    title: string;
    goal: string;
    context?: string;
    scope?: string[];
    outOfScope?: string[];
    filesAllowed?: string[];
    acceptanceCriteria: string[];
    requiredChecks?: string[];
    notes?: string;
  }): Promise<unknown>;
}

export function createToolHandlers(
  taskStore = new TaskStore(),
  gitService = new GitService(),
  testRunner = new TestRunner(),
  architectLog = new ArchitectLog(),
  projectHealthService = new ProjectHealthService()
): ToolHandlers {
  return {
    async createTask(input) {
      const task = await taskStore.createTask(input.projectPath, input);
      return { taskId: task.id, taskPath: task.taskPath, status: task.status };
    },
    async getTaskStatus(input) {
      await logOperation(architectLog, input.projectPath, "get-task-status", input.taskId, "Read task status.");
      if (input.taskId) {
        return { task: await taskStore.getTask(input.projectPath, input.taskId) };
      }

      return taskStore.readState(input.projectPath);
    },
    async readReport(input) {
      await logOperation(architectLog, input.projectPath, "read-report", input.taskId, "Read task report.");
      return taskStore.readReport(input.projectPath, input.taskId);
    },
    async inspectDiff(input) {
      await logOperation(architectLog, input.projectPath, "inspect-diff", undefined, `Inspect git diff in ${input.mode ?? "summary"} mode.`);
      return gitService.inspectDiff(input.projectPath, input.mode ?? "summary");
    },
    async runTests(input) {
      await logOperation(architectLog, input.projectPath, "run-tests", undefined, `Run checks:\n${input.commands.map((command) => `- ${command}`).join("\n")}`);
      return testRunner.run(input.projectPath, input.commands, { timeoutMs: input.timeoutMs });
    },
    async approveTask(input) {
      return { task: await taskStore.approveTask(input.projectPath, input.taskId, input.decision) };
    },
    async rejectTask(input) {
      return { task: await taskStore.rejectTask(input.projectPath, input.taskId, input.reason, input.requiredFixes) };
    },
    async projectHealth(input) {
      await logOperation(architectLog, input.projectPath, "project-health", undefined, "Read project health.");
      return projectHealthService.check(input.projectPath);
    },
    async listTasks(input) {
      await logOperation(architectLog, input.projectPath, "list-tasks", undefined, `List tasks${input.status ? ` with status ${input.status}` : ""}.`);
      return { tasks: await taskStore.listTasks(input.projectPath, input.status) };
    },
    async archiveTask(input) {
      return { task: await taskStore.archiveTask(input.projectPath, input.taskId, input.reason) };
    },
    async createNextTask(input) {
      const task = await taskStore.createNextTask(input.projectPath, input.previousTaskId, input);
      return { taskId: task.id, taskPath: task.taskPath, status: task.status };
    }
  };
}

async function logOperation(
  architectLog: ArchitectLog,
  projectPath: string,
  type: string,
  taskId: string | undefined,
  body: string
): Promise<void> {
  await architectLog.record(projectPath, {
    taskId,
    type,
    title: `MCP operation: ${type}`,
    body
  });
}

export function registerTools(server: McpServer, handlers = createToolHandlers()): void {
  server.registerTool(
    "create_task",
    {
      title: "Create Codex Task",
      description: "Create a new markdown task in the managed project's .codex task queue.",
      inputSchema: {
        projectPath: projectPathSchema,
        title: z.string().min(1),
        goal: z.string().min(1),
        context: z.string().optional(),
        scope: stringListSchema.optional(),
        outOfScope: stringListSchema.optional(),
        filesAllowed: stringListSchema.optional(),
        acceptanceCriteria: stringListSchema.optional(),
        requiredChecks: stringListSchema.optional(),
        notes: z.string().optional()
      }
    },
    async (args) => jsonResult(await handlers.createTask(args))
  );

  server.registerTool(
    "get_task_status",
    {
      title: "Get Task Status",
      description: "Return one task status or the full task state.",
      inputSchema: {
        projectPath: projectPathSchema,
        taskId: z.string().optional()
      }
    },
    async (args) => jsonResult(await handlers.getTaskStatus(args))
  );

  server.registerTool(
    "read_report",
    {
      title: "Read Codex Report",
      description: "Read a Codex markdown report for a task.",
      inputSchema: {
        projectPath: projectPathSchema,
        taskId: z.string().min(1)
      }
    },
    async (args) => jsonResult(await handlers.readReport(args))
  );

  server.registerTool(
    "inspect_diff",
    {
      title: "Inspect Git Diff",
      description: "Inspect git status and diff in summary, full, stat, or names mode.",
      inputSchema: {
        projectPath: projectPathSchema,
        mode: z.enum(["summary", "full", "stat", "names"]).default("summary")
      }
    },
    async (args) => jsonResult(await handlers.inspectDiff(args))
  );

  server.registerTool(
    "run_tests",
    {
      title: "Run Project Checks",
      description: "Run safe build/test commands from projectPath.",
      inputSchema: {
        projectPath: projectPathSchema,
        commands: z.array(z.string().min(1)).min(1),
        timeoutMs: z.number().int().positive().optional()
      }
    },
    async (args) => jsonResult(await handlers.runTests(args))
  );

  server.registerTool(
    "approve_task",
    {
      title: "Approve Task",
      description: "Mark a task approved and write an architect decision.",
      inputSchema: {
        projectPath: projectPathSchema,
        taskId: z.string().min(1),
        decision: z.string().min(1)
      }
    },
    async (args) => jsonResult(await handlers.approveTask(args))
  );

  server.registerTool(
    "reject_task",
    {
      title: "Reject Task",
      description: "Mark a task rejected, create a fix request, and write an architect decision.",
      inputSchema: {
        projectPath: projectPathSchema,
        taskId: z.string().min(1),
        reason: z.string().min(1),
        requiredFixes: z.array(z.string().min(1)).default([])
      }
    },
    async (args) => jsonResult(await handlers.rejectTask(args))
  );

  server.registerTool(
    "create_next_task",
    {
      title: "Create Next Task",
      description: "Create a follow-up task using the previous task and report as context.",
      inputSchema: {
        projectPath: projectPathSchema,
        previousTaskId: z.string().min(1),
        title: z.string().min(1),
        goal: z.string().min(1),
        context: z.string().optional(),
        scope: stringListSchema.optional(),
        outOfScope: stringListSchema.optional(),
        filesAllowed: stringListSchema.optional(),
        acceptanceCriteria: z.array(z.string().min(1)).default([]),
        requiredChecks: stringListSchema.optional(),
        notes: z.string().optional()
      }
    },
    async (args) => jsonResult(await handlers.createNextTask(args))
  );

  server.registerTool(
    "project_health",
    {
      title: "Project Health",
      description: "Check whether a project is ready for ChatGPT + Codex Orchestrator workflows.",
      inputSchema: {
        projectPath: projectPathSchema
      }
    },
    async (args) => jsonResult(await handlers.projectHealth(args))
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List tasks in the .codex queue, optionally filtered by status.",
      inputSchema: {
        projectPath: projectPathSchema,
        status: z.enum(taskStatuses).optional()
      }
    },
    async (args) => jsonResult(await handlers.listTasks(args))
  );

  server.registerTool(
    "archive_task",
    {
      title: "Archive Task",
      description: "Archive an approved or rejected task and move task/report/fix files into .codex/archive.",
      inputSchema: {
        projectPath: projectPathSchema,
        taskId: z.string().min(1),
        reason: z.string().min(1)
      }
    },
    async (args) => jsonResult(await handlers.archiveTask(args))
  );
}

function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}
