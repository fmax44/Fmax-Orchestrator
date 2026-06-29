import { ProjectBootstrap } from "../services/projectBootstrap.js";
import type { PolicyPreset } from "../services/projectPolicy.js";

const args = parseArgs(process.argv.slice(2));

if (!args.project) {
  console.error('Usage: npm run bootstrap -- --project "D:\\projects\\some-project" [--policy basic|node|docker-compose] [--force-policy]');
  process.exitCode = 1;
} else {
  try {
    const result = await new ProjectBootstrap().bootstrap(args.project, {
      policy: args.policy,
      forcePolicy: args.forcePolicy
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): { project?: string; policy?: PolicyPreset; forcePolicy: boolean } {
  const policy = readValue(args, "--policy");

  return {
    project: readValue(args, "--project") ?? readValue(args, "-p"),
    policy: isPolicyPreset(policy) ? policy : undefined,
    forcePolicy: args.includes("--force-policy")
  };
}

function readValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function isPolicyPreset(value: string | undefined): value is PolicyPreset {
  return value === "basic" || value === "node" || value === "docker-compose" || value === "python" || value === "custom";
}
