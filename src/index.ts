import { createServer } from "./mcp/server.js";
import { installStdioConsoleGuard } from "./mcp/stdioSafety.js";

installStdioConsoleGuard();

async function main(): Promise<void> {
  const server = createServer();
  await server.start();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
