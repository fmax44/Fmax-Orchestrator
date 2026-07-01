import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("fileIO", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("falls back to direct write when rename returns EPERM on Windows-style replacement", async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-codex-mcp-fileio-"));
    const filePath = path.join(projectPath, "task.md");
    await fs.writeFile(filePath, "old", "utf8");

    vi.doMock("node:fs/promises", async () => {
      const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      let firstRename = true;

      return {
        ...actual,
        rename: vi.fn(async (oldPath: string, newPath: string) => {
          if (firstRename) {
            firstRename = false;
            throw Object.assign(new Error("EPERM"), { code: "EPERM" });
          }

          return actual.rename(oldPath, newPath);
        })
      };
    });

    const { readUtf8File, writeUtf8FileAtomic } = await import("../src/utils/fileIO.js");
    await writeUtf8FileAtomic(filePath, "new");

    await expect(readUtf8File(filePath)).resolves.toBe("new");
    const directoryEntries = await fs.readdir(projectPath);
    expect(directoryEntries).toEqual(["task.md"]);
  });
});
