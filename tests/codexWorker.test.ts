import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ProjectBootstrap } from "../src/services/projectBootstrap.js";
import { CodexWorkerService } from "../src/services/codexWorker.js";
import { TaskStore } from "../src/services/taskStore.js";
import { safeExec } from "../src/utils/safeExec.js";

describe("CodexWorkerService", () => {
  it("sees a pending task and ignores approved or rejected tasks", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Approved task",
      goal: "ignore me"
    });
    await store.updateStatus(projectPath, "0001", "approved");
    await store.createTask(projectPath, {
      title: "Rejected task",
      goal: "ignore me too"
    });
    await store.updateStatus(projectPath, "0002", "rejected");
    await store.createTask(projectPath, {
      title: "Pending task",
      goal: "pick me"
    });

    const tempRoot = await mkdir(path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`), { recursive: true }).then(() =>
      path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`)
    ).catch(() => path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`));
    await mkdir(tempRoot, { recursive: true });
    const service = new CodexWorkerService();
    const result = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath: path.join(tempRoot, "status.json"),
      pidFilePath: path.join(tempRoot, "worker.pid")
    });

    expect(result.state).toBe("task_found");
    expect(result.currentTask?.taskId).toBe("0003");
  }, 20000);

  it("moves from waiting_for_codex to report_detected for the same task", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Pending task",
      goal: "wait for report"
    });

    const tempRoot = path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    const statusFilePath = path.join(tempRoot, "status.json");
    const pidFilePath = path.join(tempRoot, "worker.pid");
    const service = new CodexWorkerService();

    const first = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath,
      pidFilePath
    });
    const second = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath,
      pidFilePath
    });

    await writeFile(path.join(projectPath, ".codex", "reports", "0001-report.md"), "# Report for Task 0001\n\nDone.\n", "utf8");

    const third = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath,
      pidFilePath
    });

    expect(first.state).toBe("task_found");
    expect(second.state).toBe("waiting_for_codex");
    expect(third.state).toBe("report_detected");
    expect(third.lastReportStatus).toBe("detected");
  }, 20000);

  it("writes status snapshots without touching local-only config files", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Pending task",
      goal: "persist status"
    });

    const tempRoot = path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    const statusFilePath = path.join(tempRoot, "status.json");
    const pidFilePath = path.join(tempRoot, "worker.pid");
    const service = new CodexWorkerService();

    await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath,
      pidFilePath
    });

    const persisted = JSON.parse(await readFile(statusFilePath, "utf8")) as { state: string };
    expect(persisted.state).toBe("task_found");
    const gitignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toContain("scripts/fmax-orchestrator-codex-worker-status.json");
    expect(gitignore).toContain("scripts/fmax-orchestrator-codex-worker.pid");

    await rm(tempRoot, { recursive: true, force: true });
  }, 20000);

  it("keeps detection mode when Codex CLI is unavailable", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Pending task",
      goal: "wait safely"
    });

    const tempRoot = path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    const service = new CodexWorkerService({
      officialCodexCli: {
        probe: async () => ({
          found: false,
          execAvailable: false,
          error: "Command not found: codex"
        }),
        execute: async () => {
          throw new Error("should not execute");
        }
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath: path.join(tempRoot, "status.json"),
      pidFilePath: path.join(tempRoot, "worker.pid"),
      directExecution: {
        enabled: true
      }
    });

    expect(result.state).toBe("task_found");
    expect(result.codexCli.found).toBe(false);
    expect(result.codexCli.execAvailable).toBe(false);
    expect(result.message).toContain("official Codex CLI was not found");
  }, 20000);

  it("uses manual Codex Desktop mode by default without probing or executing Codex CLI", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Manual task",
      goal: "wait for Codex Desktop"
    });

    const tempRoot = path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    const probe = vi.fn(async () => {
      throw new Error("Codex CLI probe must not be called in manual mode");
    });
    const execute = vi.fn(async () => {
      throw new Error("codex exec must not run in manual mode");
    });
    const service = new CodexWorkerService({
      officialCodexCli: {
        probe,
        execute
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath: path.join(tempRoot, "status.json"),
      pidFilePath: path.join(tempRoot, "worker.pid")
    });

    expect(result.state).toBe("task_found");
    expect(result.message).toContain("manual Codex Desktop mode");
    expect(result.codexCli.checked).toBe(false);
    expect(result.codexCli.directExecutionEnabled).toBe(false);
    expect(probe).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  }, 20000);

  it("can report successful optional codex exec completion when the report appears", async () => {
    const projectPath = await readyProject();
    const store = new TaskStore();
    await store.createTask(projectPath, {
      title: "Pending task",
      goal: "run through codex exec"
    });

    const tempRoot = path.join(os.tmpdir(), `codex-worker-${crypto.randomUUID()}`);
    await mkdir(tempRoot, { recursive: true });
    const service = new CodexWorkerService({
      officialCodexCli: {
        probe: async () => ({
          found: true,
          execAvailable: true,
          commandPath: "C:/Codex/codex.exe"
        }),
        execute: async () => {
          await writeFile(path.join(projectPath, ".codex", "reports", "0001-report.md"), "# Report for Task 0001\n\nDone.\n", "utf8");
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: ""
          };
        }
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: projectPath }],
      once: true,
      statusFilePath: path.join(tempRoot, "status.json"),
      pidFilePath: path.join(tempRoot, "worker.pid"),
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.state).toBe("report_detected");
    expect(result.codexCli.found).toBe(true);
    expect(result.codexCli.execAvailable).toBe(true);
    expect(result.codexCli.lastExitCode).toBe(0);
  }, 20000);
});

async function readyProject(): Promise<string> {
  const projectPath = path.join(os.tmpdir(), `chatgpt-codex-mcp-worker-${crypto.randomUUID()}`);
  await mkdir(projectPath, { recursive: true });
  await safeExec(projectPath, "git init");
  await safeExec(projectPath, "git config user.email test@example.com");
  await safeExec(projectPath, "git config user.name Test");
  await new ProjectBootstrap().bootstrap(projectPath, { policy: "node" });
  await safeExec(projectPath, "git add .gitignore");
  await safeExec(projectPath, "git commit -m ready");
  return projectPath;
}
