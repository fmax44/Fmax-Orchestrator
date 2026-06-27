import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { ProjectStateService } from "../services/projectState.js";
import { registerTools } from "./tools.js";

export interface LocalMcpServer {
  start(): Promise<void>;
}

export function createServer(): LocalMcpServer {
  const mcpServer = buildMcpServer();

  return {
    async start(): Promise<void> {
      await mcpServer.connect(new StdioServerTransport());
    }
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "chatgpt-codex-mcp",
    version: "0.1.0"
  });
  const config = loadConfig();
  const projectState = new ProjectStateService();

  registerTools(server);
  registerResources(server, projectState, config.defaultProjectPath);
  registerPrompts(server);

  return server;
}

function registerResources(server: McpServer, projectState: ProjectStateService, defaultProjectPath?: string): void {
  server.registerResource(
    "project_state",
    "codex://project_state",
    {
      title: "Project State",
      description: "Structured task state, git status, report availability, and recent architect decisions.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await readDefaultProject(defaultProjectPath, (projectPath) => projectState.getProjectState(projectPath)), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "task_queue",
    "codex://task_queue",
    {
      title: "Task Queue",
      description: "Markdown contents of the current task queue for CODEX_MCP_DEFAULT_PROJECT.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(await readDefaultProject(defaultProjectPath, (projectPath) => projectState.getTaskQueue(projectPath)), null, 2)
        }
      ]
    })
  );

  server.registerResource(
    "architect_log",
    "codex://architect_log",
    {
      title: "Architect Log",
      description: "Decision log for CODEX_MCP_DEFAULT_PROJECT.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: await readDefaultProjectText(defaultProjectPath, (projectPath) => projectState.getArchitectLog(projectPath))
        }
      ]
    })
  );

  server.registerResource(
    "project_state_by_path",
    new ResourceTemplate("codex://project_state/{encodedProjectPath}", { list: undefined }),
    {
      title: "Project State by Encoded Path",
      description: "Use URL-encoded projectPath as encodedProjectPath.",
      mimeType: "application/json"
    },
    async (uri, variables) => {
      const encodedProjectPath = String(variables.encodedProjectPath);
      const projectPath = decodeURIComponent(encodedProjectPath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await projectState.getProjectState(projectPath), null, 2)
          }
        ]
      };
    }
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "architect_review_prompt",
    {
      title: "Architect Review Prompt",
      description: "Template for reviewing a completed Codex task.",
      argsSchema: {
        taskId: z.string().optional()
      }
    },
    async ({ taskId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Ты архитектор проекта. Проверь результат выполнения задачи.",
              taskId ? `Задача: ${taskId}` : undefined,
              "",
              "Проверь:",
              "1. Соответствие цели.",
              "2. Соответствие acceptance criteria.",
              "3. Качество кода.",
              "4. Тесты и сборку.",
              "5. Безопасность.",
              "6. Лишние изменения.",
              "7. Что делать дальше: approve/reject/create_next_task."
            ]
              .filter((line): line is string => line !== undefined)
              .join("\n")
          }
        }
      ]
    })
  );

  server.registerPrompt(
    "next_task_prompt",
    {
      title: "Next Task Prompt",
      description: "Template for creating the next Codex task.",
      argsSchema: {
        previousTaskId: z.string().optional()
      }
    },
    async ({ previousTaskId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Сформулируй следующую маленькую задачу для Codex Desktop.",
              previousTaskId ? `Основывайся на результате задачи ${previousTaskId}.` : undefined,
              "",
              "Укажи:",
              "- title",
              "- goal",
              "- context",
              "- scope",
              "- outOfScope",
              "- filesAllowed",
              "- acceptanceCriteria",
              "- requiredChecks",
              "- notes"
            ]
              .filter((line): line is string => line !== undefined)
              .join("\n")
          }
        }
      ]
    })
  );
}

async function readDefaultProject<T>(defaultProjectPath: string | undefined, reader: (projectPath: string) => Promise<T>): Promise<T | { error: string }> {
  if (!defaultProjectPath) {
    return {
      error: "CODEX_MCP_DEFAULT_PROJECT is not set. Use tools with explicit projectPath or set the environment variable for static resources."
    };
  }

  return reader(defaultProjectPath);
}

async function readDefaultProjectText(defaultProjectPath: string | undefined, reader: (projectPath: string) => Promise<string>): Promise<string> {
  const result = await readDefaultProject(defaultProjectPath, reader);
  return typeof result === "string" ? result : result.error;
}
