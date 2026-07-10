type StdioConsole = Pick<Console, "debug" | "error" | "info" | "log" | "warn">;

export function installStdioConsoleGuard(target: StdioConsole = console): void {
  const writeToStderr = target.error.bind(target);
  target.log = writeToStderr;
  target.info = writeToStderr;
  target.debug = writeToStderr;
  target.warn = writeToStderr;
}
