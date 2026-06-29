import { ApprovalService } from "../services/approvalService.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project || !args.taskId || !args.decision) {
  console.error('Usage: npm run approve -- --project "D:\\projects\\some-project" --task 0001 --decision "Approved by architect"');
  process.exitCode = 1;
} else {
  try {
    const result = await new ApprovalService().approve({
      projectPath: args.project,
      taskId: args.taskId,
      decision: args.decision,
      overrideReviewGate: args.overrideReviewGate,
      force: args.force,
      forceReason: args.forceReason
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): {
  project?: string;
  taskId?: string;
  decision?: string;
  overrideReviewGate: boolean;
  force: boolean;
  forceReason?: string;
} {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    taskId: readValue(args, "--task") ?? readValue(args, "--task-id"),
    decision: readValue(args, "--decision"),
    overrideReviewGate: args.includes("--override-review-gate"),
    force: args.includes("--force"),
    forceReason: readValue(args, "--force-reason")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
