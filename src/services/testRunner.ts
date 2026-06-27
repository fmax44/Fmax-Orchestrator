import { safeExec, type CommandResult, type SafeExecOptions } from "../utils/safeExec.js";

export interface TestRunResult {
  results: CommandResult[];
}

export class TestRunner {
  async run(projectPath: string, commands: string[], options: SafeExecOptions = {}): Promise<TestRunResult> {
    if (!commands.length) {
      throw new Error("At least one command is required.");
    }

    const results: CommandResult[] = [];

    for (const command of commands) {
      results.push(await safeExec(projectPath, command, options));
    }

    return { results };
  }
}
