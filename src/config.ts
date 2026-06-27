export interface AppConfig {
  defaultProjectPath?: string;
  commandTimeoutMs: number;
  maxOutputBytes: number;
}

export function loadConfig(): AppConfig {
  return {
    defaultProjectPath: process.env.CODEX_MCP_DEFAULT_PROJECT,
    commandTimeoutMs: Number(process.env.CODEX_MCP_COMMAND_TIMEOUT_MS ?? 120_000),
    maxOutputBytes: Number(process.env.CODEX_MCP_MAX_OUTPUT_BYTES ?? 80_000)
  };
}
