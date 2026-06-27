import { formatSmokeText, SmokeRunner } from "../services/smokeRunner.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  console.error('Usage: npm run smoke -- --project "D:\\projects\\some-project"');
  process.exitCode = 1;
} else {
  const result = await new SmokeRunner().run(args.project);

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSmokeText(result));
  }

  if (result.result === "FAIL") {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): { project?: string; format: "text" | "json" } {
  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    format: readValue(args, "--format") === "json" ? "json" : "text"
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}
