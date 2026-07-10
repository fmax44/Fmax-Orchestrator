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
    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain("Command timed out after 10 ms.");
  });

  it("normalizes a named TimeoutError without Execa-specific fields", async () => {
    const error = new Error("The operation timed out");
    error.name = "TimeoutError";
    execaCommand.mockRejectedValueOnce(error);

    const { safeExec } = await import("../src/utils/safeExec.js");
    const result = await safeExec(process.cwd(), "npm test", { timeoutMs: 25 });

    expect(result).toMatchObject({
      exitCode: 124,
      timedOut: true
    });
    expect(result.stderr).toContain("Command timed out after 25 ms.");
  });

  it("keeps long successful output structured and bounded", async () => {
    execaCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: "x".repeat(1_000),
      stderr: ""
    });

    const { safeExec } = await import("../src/utils/safeExec.js");
    const result = await safeExec(process.cwd(), "npm test", { maxOutputBytes: 100 });

    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain("[output truncated at 100 bytes]");
  });
});
