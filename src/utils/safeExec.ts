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
  cancelSignal?: AbortSignal;
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
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const timeoutController = new AbortController();
  let timeoutTriggered = false;
  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    timeoutController.abort();
  }, timeoutMs);
  timeout.unref();
  const cancelSignal = options.cancelSignal
    ? AbortSignal.any([options.cancelSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const result = await execaCommand(command, {
      cwd,
      shell: true,
      timeout: timeoutMs,
      maxBuffer: Math.max(options.maxOutputBytes ?? defaultMaxOutputBytes, defaultMaxOutputBytes) * 4,
      reject: false,
      cancelSignal,
      env: {
        ...process.env,
        NO_COLOR: "1"
      }
    });
    const timedOut = timeoutTriggered || result.timedOut;

    return buildCommandResult({
      command,
      exitCode: timedOut ? 124 : result.exitCode ?? 0,
      stdout: result.stdout,
      stderr: timedOut ? timeoutStderr(result.stderr, result.stdout, timeoutMs) : result.stderr,
      timedOut,
      durationMs: Date.now() - startedAt,
      maxOutputBytes: options.maxOutputBytes
    });
  } catch (error: unknown) {
    const execaError = error as ExecaError;
    const timedOut = timeoutTriggered || isTimeoutError(error);
    return buildCommandResult({
      command,
      exitCode: timedOut ? 124 : typeof execaError.exitCode === "number" ? execaError.exitCode : 1,
      stdout: String(execaError.stdout ?? ""),
      stderr: buildErrorStderr(execaError, timeoutMs, timedOut),
      timedOut,
      durationMs: Date.now() - startedAt,
      maxOutputBytes: options.maxOutputBytes
    });
  } finally {
    clearTimeout(timeout);
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

function buildErrorStderr(error: ExecaError, timeoutMs: number, timedOut = isTimeoutError(error)): string {
  if (timedOut) {
    return timeoutStderr(error.stderr, error.stdout, timeoutMs);
  }

  return String(error.stderr ?? error.message ?? error);
}

function timeoutStderr(stderr: unknown, stdout: unknown, timeoutMs: number): string {
  const details = String(stderr || stdout || "").trim();
  return details
    ? `Command timed out after ${timeoutMs} ms.\n${details}`
    : `Command timed out after ${timeoutMs} ms.`;
}

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    timedOut?: unknown;
    name?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  return (
    candidate.timedOut === true ||
    candidate.name === "TimeoutError" ||
    candidate.code === "ETIMEDOUT" ||
    (candidate.cause !== error && isTimeoutError(candidate.cause))
  );
}
