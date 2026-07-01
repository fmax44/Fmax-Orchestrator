import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execaCommand } from "execa";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { CodexNextService } from "../src/services/codexNext.js";
import { RelayStatusService } from "../src/services/relayStatus.js";
import { TaskStore } from "../src/services/taskStore.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("relay workflow helpers", () => {
  it("reports Codex as the next actor for a pending task without report", async () => {
    const projectPath = await readyProject();
    await createTask(projectPath);

    const relay = await new RelayStatusService().check({ projectPath, includeDoctor: false });

    expect(relay.currentTask?.id).toBe("0001");
    expect(relay.waitingFor).toBe("codex");
    expect(relay.nextActor).toBe("codex");
  }, 30000);

  it("reports review as the next step when report exists", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);

    const relay = await new RelayStatusService().check({ projectPath, includeDoctor: false });

    expect(relay.currentTask?.status).toBe("reported");
    expect(relay.waitingFor).toBe("review");
    expect(relay.nextActor).toBe("chatgpt");
    expect(relay.nextAction).toContain("review_gate");
  }, 30000);

  it("prepares the next Codex task and detects an existing reported task", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeReport(projectPath, taskId);

    const result = await new CodexNextService().prepare({ projectPath });

    expect(result.task?.id).toBe("0001");
    expect(result.waitingFor).toBe("chatgpt");
    expect(result.nextAction).toContain("ChatGPT should review");
  }, 15000);

  it("treats a BOM-prefixed report as a detected report for Codex next", async () => {
    const projectPath = await readyProject();
    const taskId = await createTask(projectPath);
    await writeFile(path.join(projectPath, ".codex", "reports", `${taskId}-report.md`), `\uFEFF# Report for Task ${taskId}\n\nRelay test report.\n`, "utf8");

    const result = await new CodexNextService().prepare({ projectPath });

    expect(result.task?.id).toBe(taskId);
    expect(result.task?.reportExists).toBe(true);
    expect(result.waitingFor).toBe("chatgpt");
  }, 15000);

  it("prepares the newest reported task when multiple reports are waiting", async () => {
    const projectPath = await readyProject();
    const firstTaskId = await createTask(projectPath);
    await writeReport(projectPath, firstTaskId);
    const secondTaskId = await createTask(projectPath);
    await writeReport(projectPath, secondTaskId);

    const result = await new CodexNextService().prepare({ projectPath });

    expect(result.task?.id).toBe(secondTaskId);
    expect(result.waitingFor).toBe("chatgpt");
  }, 15000);

  it("supports relay:status and codex:next through the CLI", async () => {
    const projectPath = await readyProject();
    await createTask(projectPath);

    const relayResult = await execaCommand(`npm run relay:status -- --project "${projectPath}" --format json --no-doctor`, {
      cwd: process.cwd(),
      shell: true
    });
    const relayParsed = JSON.parse(relayResult.stdout.slice(relayResult.stdout.indexOf("{"))) as { nextActor: string };
    expect(relayParsed.nextActor).toBe("codex");

    const codexResult = await execaCommand(`npm run codex:next -- --project "${projectPath}" --format json`, {
      cwd: process.cwd(),
      shell: true
    });
    const codexParsed = JSON.parse(codexResult.stdout.slice(codexResult.stdout.indexOf("{"))) as { task?: { id: string } };
    expect(codexParsed.task?.id).toBe("0001");
  }, 30000);
});

async function readyProject(): Promise<string> {
  const projectPath = path.join(os.tmpdir(), `chatgpt-codex-mcp-relay-${crypto.randomUUID()}`);
  await mkdir(projectPath, { recursive: true });
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(projectPath, { policy: "node" });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}

async function createTask(projectPath: string): Promise<string> {
  const task = await new TaskStore().createTask(projectPath, {
    title: "Relay task",
    goal: "Exercise relay workflow",
    filesAllowed: ["docs/guide.md"],
    requiredChecks: ["git status --short"]
  });
  return task.id;
}

async function writeReport(projectPath: string, taskId: string): Promise<void> {
  await writeFile(path.join(projectPath, ".codex", "reports", `${taskId}-report.md`), `# Report for Task ${taskId}\n\nRelay test report.\n`, "utf8");
}
