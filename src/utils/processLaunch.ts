import { spawn } from "node:child_process";

export interface DetachedCommandOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export async function launchDetachedProcess(options: DetachedCommandOptions): Promise<void> {
  const child = spawnDetached(options);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    child.once("spawn", () => {
      if (settled) {
        return;
      }
      settled = true;
      child.unref();
      resolve();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`Failed to start ${options.command}: ${error.message}`));
    });
  });
}

function spawnDetached(options: DetachedCommandOptions) {
  const args = options.args ?? [];
  const common = {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...options.env
    },
    detached: true,
    stdio: "ignore" as const,
    windowsHide: true
  };

  if (process.platform !== "win32") {
    return spawn(options.command, args, common);
  }

  if (/\.(cmd|bat)$/i.test(options.command)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", buildWindowsCommand(options.command, args)], common);
  }

  if (/\.ps1$/i.test(options.command)) {
    return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", options.command, ...args], common);
  }

  return spawn(options.command, args, common);
}

function buildWindowsCommand(command: string, args: string[]): string {
  return [quoteWindowsArg(command), ...args.map((arg) => quoteWindowsArg(arg))].join(" ");
}

function quoteWindowsArg(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  const escaped = value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1");
  return /[\s"]/u.test(value) ? `"${escaped}"` : escaped;
}
