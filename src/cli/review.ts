import { formatReviewGateText, ReviewGateService } from "../services/reviewGate.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project || !args.taskId) {
  console.error('Usage: npm run review -- --project "D:\\projects\\some-project" --task 0001 [--format json] [--write-report]');
  process.exitCode = 1;
} else {
  try {
    const result = await new ReviewGateService().run({
      projectPath: args.project,
      taskId: args.taskId,
      checks: args.checks,
      requireReport: args.requireReport,
      writeReport: args.writeReport
    });

    if (args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatReviewGateText(result));
    }

    if (result.decision === "BLOCKED") {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): {
  project?: string;
  taskId?: string;
  format: "text" | "json";
  checks?: string[];
  requireReport?: boolean;
  writeReport: boolean;
} {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    taskId: readValue(args, "--task") ?? readValue(args, "--task-id"),
    format: readValue(args, "--format") === "json" ? "json" : "text",
    checks: parseChecks(readValue(args, "--checks")),
    requireReport: args.includes("--no-require-report") ? false : args.includes("--require-report") ? true : undefined,
    writeReport: args.includes("--write-report")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function parseChecks(value: string | undefined): string[] | undefined {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
