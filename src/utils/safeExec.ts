import { execaCommand, type ExecaError } from "execa";
import { resolveProjectPath } from "./paths.js";

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  truncated: boolean;
}

export interface SafeExecOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  allowNetworkDownload?: boolean;
}

const defaultTimeoutMs = 120_000;
const defaultMaxOutputBytes = 80_000;
const denyPatterns = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/s\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\b(printenv|set\s*$|env\s*$|Get-ChildItem\s+Env:|gci\s+Env:)\b/i,
  /\b(cat|type|Get-Content)\s+.*(\.env|secret|secrets)\b/i
];

export async function safeExec(
  projectPath: string,
  command: string,
  options: SafeExecOptions = {}
): Promise<CommandResult> {
  const cwd = await resolveProjectPath(projectPath);
  validateCommand(command, options);
  const startedAt = Date.now();

  try {
    const result = await execaCommand(command, {
      cwd,
      shell: true,
      timeout: options.timeoutMs ?? defaultTimeoutMs,
      maxBuffer: Math.max(options.maxOutputBytes ?? defaultMaxOutputBytes, defaultMaxOutputBytes) * 4,
      reject: false,
      env: {
        ...process.env,
        NO_COLOR: "1"
      }
    });

    return buildCommandResult({
      command,
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: false,
      durationMs: Date.now() - startedAt,
      maxOutputBytes: options.maxOutputBytes
    });
  } catch (error: unknown) {
    const execaError = error as ExecaError;
    return buildCommandResult({
      command,
      exitCode: typeof execaError.exitCode === "number" ? execaError.exitCode : 1,
      stdout: String(execaError.stdout ?? ""),
      stderr: buildErrorStderr(execaError, options.timeoutMs ?? defaultTimeoutMs),
      timedOut: Boolean(execaError.timedOut),
      durationMs: Date.now() - startedAt,
      maxOutputBytes: options.maxOutputBytes
    });
  }
}

export function validateCommand(command: string, options: SafeExecOptions = {}): void {
  const trimmed = command.trim();

  if (!trimmed) {
    throw new Error("Command must not be empty.");
  }

  if (/\bpowershell\b.*\bInvoke-WebRequest\b/i.test(trimmed) && !options.allowNetworkDownload) {
    throw new Error("Command is blocked by denylist: powershell Invoke-WebRequest requires explicit allowNetworkDownload.");
  }

  for (const pattern of denyPatterns) {
    if (pattern.test(trimmed)) {
      throw new Error(`Command is blocked by denylist: ${command}`);
    }
  }
}

export function sanitizeOutput(output: string, maxOutputBytes = defaultMaxOutputBytes): string {
  const redacted = output
    .replace(/([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[=:]\s*)[^\s]+/gi, "$1[redacted]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]");

  if (Buffer.byteLength(redacted, "utf8") <= maxOutputBytes) {
    return redacted;
  }

  return `${redacted.slice(0, maxOutputBytes)}\n[output truncated at ${maxOutputBytes} bytes]`;
}

function buildCommandResult(input: {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  maxOutputBytes?: number;
}): CommandResult {
  const maxOutputBytes = input.maxOutputBytes ?? defaultMaxOutputBytes;
  const stdout = sanitizeOutput(input.stdout, maxOutputBytes);
  const stderr = sanitizeOutput(input.stderr, maxOutputBytes);

  return {
    command: input.command,
    exitCode: input.exitCode,
    stdout,
    stderr,
    timedOut: input.timedOut,
    durationMs: input.durationMs,
    truncated:
      stdout.includes("[output truncated at") ||
      stderr.includes("[output truncated at")
  };
}

function buildErrorStderr(error: ExecaError, timeoutMs: number): string {
  if (error.timedOut) {
    const details = String(error.stderr ?? error.stdout ?? "").trim();
    return details
      ? `Command timed out after ${timeoutMs} ms.\n${details}`
      : `Command timed out after ${timeoutMs} ms.`;
  }

  return String(error.stderr ?? error.message ?? error);
}
