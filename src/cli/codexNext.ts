import { CodexNextService, formatCodexNextText } from "../services/codexNext.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  console.error('Usage: npm run codex:next -- --project "D:\\projects\\some-project" [--watch] [--timeout-ms 300000] [--poll-interval-ms 2000]');
  process.exitCode = 1;
} else {
  try {
    const result = await new CodexNextService().prepare({
      projectPath: args.project,
      watch: args.watch,
      timeoutMs: args.timeoutMs,
      pollIntervalMs: args.pollIntervalMs
    });

    if (args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatCodexNextText(result));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): {
  project?: string;
  watch: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  format: "text" | "json";
} {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    watch: args.includes("--watch"),
    timeoutMs: readNumber(args, "--timeout-ms"),
    pollIntervalMs: readNumber(args, "--poll-interval-ms"),
    format: readValue(args, "--format") === "json" ? "json" : "text"
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readNumber(args: string[], name: string): number | undefined {
  const value = readValue(args, name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
