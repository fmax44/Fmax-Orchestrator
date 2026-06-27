import { ProjectBootstrap } from "../services/projectBootstrap.js";

const projectPath = readProjectArg(process.argv.slice(2));

if (!projectPath) {
  console.error('Usage: npm run bootstrap -- --project "D:\\projects\\some-project"');
  process.exitCode = 1;
} else {
  try {
    const result = await new ProjectBootstrap().bootstrap(projectPath);
    console.log(JSON.stringify(result, null, 2));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

function readProjectArg(args: string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--project" || arg === "-p");
  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}
