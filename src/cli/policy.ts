import { ProjectPolicyService } from "../services/projectPolicy.js";

const args = parseArgs(process.argv.slice(2));
const service = new ProjectPolicyService();

if (!args.project) {
  console.error('Usage: npm run policy -- --project "D:\\projects\\some-project" [--format json] [--validate-task 0001] [--validate-diff]');
  process.exitCode = 1;
} else {
  try {
    const result = args.validateTask
      ? await service.validateTaskAgainstPolicy(args.project, args.validateTask)
      : args.validateDiff
        ? await service.validateDiffAgainstPolicy(args.project)
        : await service.readPolicy(args.project);

    if (args.format === "json") {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatPolicyText(result));
    }

    if ("valid" in result && !result.valid) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): { project?: string; format: "text" | "json"; validateTask?: string; validateDiff: boolean } {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    format: readValue(args, "--format") === "json" ? "json" : "text",
    validateTask: readValue(args, "--validate-task"),
    validateDiff: args.includes("--validate-diff")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function formatPolicyText(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return String(result);
  }

  if ("valid" in result) {
    const validation = result as { valid: boolean; warnings?: string[]; errors?: string[]; manualApprovalRequired?: boolean; changedFiles?: string[]; taskId?: string };
    return [
      "Project Policy Validation",
      "",
      validation.taskId ? `Task: ${validation.taskId}` : undefined,
      validation.changedFiles ? `Changed files: ${validation.changedFiles.join(", ") || "none"}` : undefined,
      `Manual approval required: ${validation.manualApprovalRequired ? "yes" : "no"}`,
      ...(validation.warnings?.length ? ["", "Warnings:", ...validation.warnings.map((warning) => `- ${warning}`)] : []),
      ...(validation.errors?.length ? ["", "Errors:", ...validation.errors.map((error) => `- ${error}`)] : []),
      "",
      `Result: ${validation.valid ? "VALID" : "INVALID"}`
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
  }

  const read = result as { exists?: boolean; policyPath?: string; policy?: { projectName?: string; version?: number; defaultProfile?: string; defaultSmokeMode?: string }; warnings?: string[]; errors?: string[] };
  return [
    "Project Policy",
    "",
    `Exists: ${read.exists ? "yes" : "no"}`,
    read.policyPath ? `Path: ${read.policyPath}` : undefined,
    read.policy?.projectName ? `Project: ${read.policy.projectName}` : undefined,
    read.policy?.version ? `Version: ${read.policy.version}` : undefined,
    read.policy?.defaultProfile ? `Default profile: ${read.policy.defaultProfile}` : undefined,
    read.policy?.defaultSmokeMode ? `Default smoke mode: ${read.policy.defaultSmokeMode}` : undefined,
    ...(read.warnings?.length ? ["", "Warnings:", ...read.warnings.map((warning) => `- ${warning}`)] : []),
    ...(read.errors?.length ? ["", "Errors:", ...read.errors.map((error) => `- ${error}`)] : [])
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
