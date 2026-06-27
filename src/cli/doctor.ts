import { DoctorService, formatDoctorText } from "../services/doctor.js";
import type { CheckProfile } from "../services/dockerComposeProfile.js";

const args = parseArgs(process.argv.slice(2));
const result = await new DoctorService().run({
  projectPath: args.project,
  profile: args.profile,
  allowComposeConfigOutput: args.allowComposeConfigOutput
});

if (args.format === "json") {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatDoctorText(result));
}

if (result.result === "NOT_READY") {
  process.exitCode = 1;
}

function parseArgs(args: string[]): { project?: string; format: "text" | "json"; profile: CheckProfile; allowComposeConfigOutput: boolean } {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    format: readValue(args, "--format") === "json" ? "json" : "text",
    profile: readValue(args, "--profile") === "docker-compose" ? "docker-compose" : "default",
    allowComposeConfigOutput: args.includes("--allow-compose-config-output")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
