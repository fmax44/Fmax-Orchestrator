import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("dashboard local config shape", () => {
  it("supports a browserPath field in local config files", async () => {
    const filePath = path.join(process.cwd(), "src", "services", "dashboardConfig.ts");
    const content = await readFile(filePath, "utf8");

    expect(content).toContain("browserPath?: string;");
  });
});
