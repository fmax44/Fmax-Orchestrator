import { formatSmokeText, SmokeRunner } from "../services/smokeRunner.js";
import type { CheckProfile } from "../services/dockerComposeProfile.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  console.error('Usage: npm run smoke -- --project "D:\\projects\\some-project"');
  process.exitCode = 1;
} else {
  const result = await new SmokeRunner().run(args.project, {
    ephemeral: args.ephemeral,
    profile: args.profile,
    allowComposeConfigOutput: args.allowComposeConfigOutput
  });

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSmokeText(result));
  }

  if (result.result === "FAIL") {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): { project?: string; format: "text" | "json"; ephemeral: boolean; profile: CheckProfile; allowComposeConfigOutput: boolean } {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    format: readValue(args, "--format") === "json" ? "json" : "text",
    ephemeral: args.includes("--ephemeral"),
    profile: readValue(args, "--profile") === "docker-compose" ? "docker-compose" : "default",
    allowComposeConfigOutput: args.includes("--allow-compose-config-output")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
