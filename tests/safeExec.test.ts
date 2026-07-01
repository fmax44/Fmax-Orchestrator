import { beforeEach, describe, expect, it, vi } from "vitest";

const execaCommand = vi.fn();

vi.mock("execa", () => ({
  execaCommand
}));

describe("safeExec timeout handling", () => {
  beforeEach(() => {
    execaCommand.mockReset();
  });

  it("returns a clear timeout result when the subprocess times out", async () => {
    execaCommand.mockRejectedValueOnce({
      exitCode: 1,
      stdout: "",
      stderr: "",
      timedOut: true,
      shortMessage: "timed out"
    });

    const { safeExec } = await import("../src/utils/safeExec.js");
    const projectPath = process.cwd();
    const result = await safeExec(projectPath, "npm test", { timeoutMs: 10 });

    expect(result.timedOut).toBe(true);
    expect(result.stderr).toContain("Command timed out after 10 ms.");
  });
});
