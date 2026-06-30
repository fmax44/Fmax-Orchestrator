import { describe, expect, it, vi } from "vitest";
import { CodexAutonomousRunService } from "../src/services/codexAutonomousRun.js";

describe("CodexAutonomousRunService", () => {
  it("returns dry_run and never invokes codex exec", async () => {
    const workerRun = vi.fn(async () => {
      throw new Error("worker run must not be called in dry-run");
    });
    const service = new CodexAutonomousRunService({
      codexNextService: {
        prepare: async () => ({
          projectPath: "D:/projects/demo",
          waitingFor: "codex",
          nextAction: "Open Codex Desktop and execute task 0001.",
          codexInstruction: "Do the task",
          watch: { enabled: false, timeoutMs: 1000, reportDetected: false, timedOut: false },
          task: {
            id: "0001",
            title: "Demo",
            status: "pending",
            taskPath: ".codex/tasks/0001-task.md",
            reportPath: ".codex/reports/0001-report.md",
            reportExists: false
          }
        })
      },
      codexWorkerService: {
        run: workerRun,
        inspectEnvironment: async () => ({
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "read-only"
        })
      },
      gitService: {
        inspectDiff: async () => ({
          mode: "names",
          status: "",
          output: "",
          truncated: false
        })
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      dryRun: true,
      directExecution: {
        enabled: true,
        command: "codex",
        sandbox: "read-only"
      }
    });

    expect(result.executionState).toBe("dry_run");
    expect(result.plannedCommand).toContain("codex exec");
    expect(workerRun).not.toHaveBeenCalled();
  });

  it("returns blocked when direct execution is disabled", async () => {
    const workerRun = vi.fn(async () => {
      throw new Error("worker run must not be called when disabled");
    });
    const inspectEnvironment = vi.fn(async () => ({
      command: "codex",
      found: true,
      execAvailable: true,
      directExecutionEnabled: false,
      sandbox: "read-only"
    }));
    const service = new CodexAutonomousRunService({
      codexNextService: {
        prepare: async () => ({
          projectPath: "D:/projects/demo",
          waitingFor: "codex",
          nextAction: "Open Codex Desktop and execute task 0001.",
          codexInstruction: "Do the task",
          watch: { enabled: false, timeoutMs: 1000, reportDetected: false, timedOut: false },
          task: {
            id: "0001",
            title: "Demo",
            status: "pending",
            taskPath: ".codex/tasks/0001-task.md",
            reportPath: ".codex/reports/0001-report.md",
            reportExists: false
          }
        })
      },
      codexWorkerService: {
        run: workerRun,
        inspectEnvironment
      },
      gitService: {
        inspectDiff: async () => ({
          mode: "names",
          status: "",
          output: "",
          truncated: false
        })
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      directExecution: {
        enabled: false
      }
    });

    expect(result.executionState).toBe("blocked");
    expect(result.nextRecommendedAction).toBe("fix_blocker");
    expect(workerRun).not.toHaveBeenCalled();
    expect(inspectEnvironment).not.toHaveBeenCalled();
  });

  it("waits for report detection and returns review-oriented output", async () => {
    const workerRun = vi
      .fn()
      .mockResolvedValueOnce({
        state: "waiting_for_codex",
        updatedAt: "2026-06-30T12:00:00.000Z",
        pollIntervalMs: 1,
        message: "Waiting for report.",
        currentTask: {
          projectName: "demo",
          projectPath: "D:/projects/demo",
          taskId: "0001",
          title: "Demo",
          status: "pending",
          taskPath: ".codex/tasks/0001-task.md",
          reportPath: ".codex/reports/0001-report.md",
          reportExists: false,
          instruction: "Do the task"
        },
        lastReportStatus: "missing",
        directCodexLaunchSupported: false,
        limitations: [],
        codexCli: {
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "workspace-write",
          lastExitCode: 0
        },
        host: "host",
        pid: 1
      })
      .mockResolvedValueOnce({
        state: "report_detected",
        updatedAt: "2026-06-30T12:00:01.000Z",
        pollIntervalMs: 1,
        message: "Report detected.",
        currentTask: {
          projectName: "demo",
          projectPath: "D:/projects/demo",
          taskId: "0001",
          title: "Demo",
          status: "reported",
          taskPath: ".codex/tasks/0001-task.md",
          reportPath: ".codex/reports/0001-report.md",
          reportExists: true,
          instruction: "Do the task"
        },
        lastReportStatus: "detected",
        directCodexLaunchSupported: false,
        limitations: [],
        codexCli: {
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "workspace-write",
          lastExitCode: 0
        },
        host: "host",
        pid: 1
      });

    const service = new CodexAutonomousRunService({
      codexNextService: {
        prepare: async () => ({
          projectPath: "D:/projects/demo",
          waitingFor: "codex",
          nextAction: "Open Codex Desktop and execute task 0001.",
          codexInstruction: "Do the task",
          watch: { enabled: false, timeoutMs: 1000, reportDetected: false, timedOut: false },
          task: {
            id: "0001",
            title: "Demo",
            status: "pending",
            taskPath: ".codex/tasks/0001-task.md",
            reportPath: ".codex/reports/0001-report.md",
            reportExists: false
          }
        })
      },
      codexWorkerService: {
        run: workerRun,
        inspectEnvironment: async () => ({
          command: "codex",
          found: true,
          execAvailable: true,
          directExecutionEnabled: true,
          sandbox: "workspace-write"
        })
      },
      gitService: {
        inspectDiff: async () => ({
          mode: "names",
          status: "M src/demo.ts",
          output: "src/demo.ts",
          truncated: false
        })
      }
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      pollIntervalMs: 1,
      waitTimeoutMs: 20,
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.executionState).toBe("report_detected");
    expect(result.reportExists).toBe(true);
    expect(result.nextRecommendedAction).toBe("run_review_gate");
    expect(result.changedFilesSummary).toEqual(["src/demo.ts"]);
    expect(workerRun).toHaveBeenCalledTimes(2);
  });
});
