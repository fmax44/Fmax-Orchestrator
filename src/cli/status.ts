import { formatProjectStatusText, ProjectStatusService } from "../services/projectStatus.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  console.error('Usage: npm run status -- --project "D:\\projects\\some-project" [--format json] [--include-smoke] [--no-doctor] [--include-review] [--task 0001]');
  process.exitCode = 1;
} else {
  try {
    const result = await new ProjectStatusService().check({
      projectPath: args.project,
      includeSmoke: args.includeSmoke,
      includeDoctor: args.includeDoctor,
      includeReview: args.includeReview,
      taskId: args.taskId
    });

    if (args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatProjectStatusText(result));
    }

    if (result.errors.length > 0) {
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
  format: "text" | "json";
  includeSmoke: boolean;
  includeDoctor: boolean;
  includeReview: boolean;
  taskId?: string;
} {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    format: readValue(args, "--format") === "json" ? "json" : "text",
    includeSmoke: args.includes("--include-smoke"),
    includeDoctor: !args.includes("--no-doctor"),
    includeReview: args.includes("--include-review") || !args.includes("--no-review"),
    taskId: readValue(args, "--task") ?? readValue(args, "--task-id")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
