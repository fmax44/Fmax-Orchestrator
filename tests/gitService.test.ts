import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitService } from "../src/services/gitService.js";
import { TestRunner } from "../src/services/testRunner.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("GitService", () => {
  it("returns git diff summary", async () => {
    const projectPath = await tempGitProject();
    await writeFile(path.join(projectPath, "README.md"), "changed\n", "utf8");

    const diff = await new GitService().inspectDiff(projectPath, "summary");

    expect(diff.status).toContain("M README.md");
    expect(diff.output).toContain("git diff --stat");
    expect(diff.output).toContain("README.md");
  }, 15000);

  it("runs safe commands and blocks dangerous commands", async () => {
    const projectPath = await tempProject();

    await expect(safeExec(projectPath, "node -e \"console.log('ok')\"")).resolves.toMatchObject({
      exitCode: 0,
      stdout: "ok"
    });
    await expect(new TestRunner().run(projectPath, ["rm -rf ."])).rejects.toThrow("blocked by denylist");
  });
});

async function tempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `chatgpt-codex-mcp-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function tempGitProject(): Promise<string> {
  const root = await tempProject();
  await safeExec(root, "git init");
  await safeExec(root, "git config user.email test@example.com");
  await safeExec(root, "git config user.name Test");
  await writeFile(path.join(root, "README.md"), "initial\n", "utf8");
  await safeExec(root, "git add README.md");
  await safeExec(root, "git commit -m initial");
  return root;
}
