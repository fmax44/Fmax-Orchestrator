import { describe, expect, it, vi } from "vitest";
import { installStdioConsoleGuard } from "../src/mcp/stdioSafety.js";

describe("stdio MCP logging safety", () => {
  it("redirects console output away from protocol stdout", () => {
    const stderr = vi.fn();
    const target = {
      log: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: stderr
    };

    installStdioConsoleGuard(target);
    target.log("log");
    target.info("info");
    target.debug("debug");
    target.warn("warn");

    expect(stderr.mock.calls).toEqual([["log"], ["info"], ["debug"], ["warn"]]);
  });
});
