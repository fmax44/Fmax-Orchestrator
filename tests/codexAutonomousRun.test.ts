import { describe, expect, it, vi } from "vitest";
import { CodexAutonomousRunService } from "../src/services/codexAutonomousRun.js";

describe("CodexAutonomousRunService", () => {
  it("returns dry_run and never invokes codex exec", async () => {
    const workerRun = vi.fn(async () => {
      throw new Error("worker run must not be called in dry-run");
    });
    const service = createService({
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: ""
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
    expect(result.directExecutionReason).toContain("dry-run");
    expect(result.plannedCommand).toContain("codex exec");
    expect(result.plannedCommand).not.toContain("git commit");
    expect(result.plannedCommand).not.toContain("git push");
    expect(workerRun).not.toHaveBeenCalled();
  });

  it("returns blocked when direct execution is disabled", async () => {
    const workerRun = vi.fn(async () => {
      throw new Error("worker run must not be called when disabled");
    });
    const inspectEnvironment = vi.fn(async () => createRuntime({ directExecutionEnabled: false }));
    const service = createService({
      workerRun,
      inspectEnvironment,
      gitOutput: ""
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
    expect(result.directExecutionReason).toContain("worker.directExecution.enabled is false");
    expect(workerRun).not.toHaveBeenCalled();
    expect(inspectEnvironment).not.toHaveBeenCalled();
  });

  it("matches a Windows project path against managedProjects", async () => {
    const prepare = vi.fn(async ({ projectPath }: { projectPath: string }) =>
      createPendingTask({
        projectPath,
        taskId: "0002"
      })
    );
    const workerRun = vi.fn(async () => createWorkerStatus("report_detected"));
    const service = createService({
      prepare,
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: "src/demo.ts"
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/chatgpt-codex-mcp" }],
      projectPath: "D:\\projects\\chatgpt-codex-mcp",
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.taskId).toBe("0001");
    expect(prepare).toHaveBeenCalledWith({ projectPath: "D:/projects/chatgpt-codex-mcp" });
  });

  it("checks only the selected managed project when projectPath is provided", async () => {
    const prepare = vi.fn(async ({ projectPath }: { projectPath: string }) => {
      if (projectPath === "D:/projects/selected") {
        return createPendingTask({
          projectPath,
          taskId: "0003"
        });
      }

      return {
        projectPath,
        waitingFor: "chatgpt" as const,
        nextAction: "No task",
        codexInstruction: "",
        watch: { enabled: false, timeoutMs: 1000, reportDetected: false, timedOut: false }
      };
    });
    const service = createService({
      prepare,
      workerRun: vi.fn(async () => createWorkerStatus("report_detected")),
      inspectEnvironment: async () => createRuntime(),
      gitOutput: ""
    });

    await service.run({
      projects: [
        { name: "other", path: "D:/projects/other" },
        { name: "selected", path: "D:/projects/selected" }
      ],
      projectPath: "D:/projects/selected",
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith({ projectPath: "D:/projects/selected" });
  });

  it("waits for report detection and returns review-oriented output", async () => {
    const workerRun = vi
      .fn()
      .mockResolvedValueOnce(createWorkerStatus("waiting_for_codex", { reportExists: false }))
      .mockResolvedValueOnce(createWorkerStatus("report_detected", { reportExists: true, lastReportStatus: "detected" }));

    const service = createService({
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: "src/demo.ts"
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

  it("returns report_missing when codex exec finished but report was not detected", async () => {
    const workerRun = vi
      .fn()
      .mockResolvedValue(createWorkerStatus("waiting_for_codex", {
        reportExists: false,
        lastExitCode: 0,
        lastError: undefined
      }));
    const service = createService({
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: "src/demo.ts"
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      pollIntervalMs: 1,
      waitTimeoutMs: 2,
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.executionState).toBe("report_missing");
    expect(result.nextRecommendedAction).toBe("inspect_worker_output");
    expect(result.directExecutionReason).toContain("report was not detected");
    expect(result.message).toContain("was not detected");
    expect(result.codexCli?.lastExitCode).toBe(0);
  });

  it("surfaces a report write blocker when codex exec output shows access denied", async () => {
    const workerRun = vi
      .fn()
      .mockResolvedValue(createWorkerStatus("waiting_for_codex", {
        reportExists: false,
        lastExitCode: 0,
        lastError: "Set-Content : Access is denied."
      }));
    const service = createService({
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: ""
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      pollIntervalMs: 1,
      waitTimeoutMs: 2,
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.executionState).toBe("report_missing");
    expect(result.directExecutionReason).toContain("write access denied");
    expect(result.message).toContain("blocked inside the Codex runtime");
  });

  it("returns timeout when report detection never reaches a terminal success state", async () => {
    const workerRun = vi
      .fn()
      .mockResolvedValue(createWorkerStatus("waiting_for_codex", {
        reportExists: false,
        lastExitCode: undefined,
        lastError: "Timed out"
      }));
    const service = createService({
      workerRun,
      inspectEnvironment: async () => createRuntime(),
      gitOutput: ""
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      pollIntervalMs: 1,
      waitTimeoutMs: 2,
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.executionState).toBe("timeout");
    expect(result.nextRecommendedAction).toBe("manual_codex_run");
    expect(result.directExecutionReason).toContain("did not reach a successful terminal");
    expect(result.message).toContain("Timed out waiting");
  });

  it("never returns auto-approve, auto-commit, or push actions from the autonomous loop", async () => {
    const service = createService({
      workerRun: vi.fn(async () => createWorkerStatus("report_detected", { reportExists: true, lastReportStatus: "detected" })),
      inspectEnvironment: async () => createRuntime(),
      gitOutput: "src/demo.ts"
    });

    const result = await service.run({
      projects: [{ name: "demo", path: "D:/projects/demo" }],
      statusFilePath: "D:/tmp/status.json",
      pidFilePath: "D:/tmp/worker.pid",
      directExecution: {
        enabled: true,
        sandbox: "workspace-write"
      }
    });

    expect(result.nextRecommendedAction).toBe("run_review_gate");
    expect(["approve_task", "commit_changes", "push_changes"]).not.toContain(result.nextRecommendedAction);
  });
});

function createService(input: {
  prepare?: (args: { projectPath: string }) => Promise<ReturnType<typeof createPendingTask> | {
    projectPath: string;
    waitingFor: "chatgpt";
    nextAction: string;
    codexInstruction: string;
    watch: { enabled: boolean; timeoutMs: number; reportDetected: boolean; timedOut: boolean };
  }>;
  workerRun?: ReturnType<typeof vi.fn>;
  inspectEnvironment?: () => Promise<{
    command: string;
    found: boolean;
    execAvailable: boolean;
    directExecutionEnabled: boolean;
    sandbox: "workspace-write";
    lastError?: string;
    lastExitCode?: number;
  }>;
  gitOutput: string;
}) {
  return new CodexAutonomousRunService({
    codexNextService: {
      prepare: input.prepare ?? (async ({ projectPath }) => createPendingTask({ projectPath }))
    },
    codexWorkerService: {
      run: input.workerRun ?? vi.fn(async () => createWorkerStatus("report_detected")),
      inspectEnvironment: input.inspectEnvironment ?? (async () => createRuntime())
    },
    gitService: {
      inspectDiff: async () => ({
        mode: "names",
        status: input.gitOutput ? `M ${input.gitOutput}` : "",
        output: input.gitOutput,
        truncated: false
      })
    }
  });
}

function createPendingTask(input: { projectPath: string; taskId?: string }) {
  const taskId = input.taskId ?? "0001";
  return {
    projectPath: input.projectPath,
    waitingFor: "codex" as const,
    nextAction: `Open Codex Desktop and execute task ${taskId}.`,
    codexInstruction: "Do the task",
    watch: { enabled: false, timeoutMs: 1000, reportDetected: false, timedOut: false },
    task: {
      id: taskId,
      title: "Demo",
      status: "pending",
      taskPath: `.codex/tasks/${taskId}-task.md`,
      reportPath: `.codex/reports/${taskId}-report.md`,
      reportExists: false
    }
  };
}

function createRuntime(overrides: Partial<{
  command: string;
  found: boolean;
  execAvailable: boolean;
  directExecutionEnabled: boolean;
  sandbox: "workspace-write";
  lastError?: string;
  lastExitCode?: number;
}> = {}) {
  return {
    command: "codex",
    found: true,
    execAvailable: true,
    directExecutionEnabled: true,
    sandbox: "workspace-write" as const,
    ...overrides
  };
}

function createWorkerStatus(
  state: "waiting_for_codex" | "report_detected" | "error",
  overrides: {
    reportExists?: boolean;
    lastReportStatus?: "missing" | "detected";
    lastExitCode?: number | undefined;
    lastError?: string | undefined;
  } = {}
) {
  const reportExists = overrides.reportExists ?? state === "report_detected";
  return {
    state,
    updatedAt: "2026-06-30T12:00:00.000Z",
    pollIntervalMs: 1,
    message: state === "report_detected" ? "Report detected." : "Waiting for report.",
    currentTask: {
      projectName: "demo",
      projectPath: "D:/projects/demo",
      taskId: "0001",
      title: "Demo",
      status: reportExists ? "reported" : "pending",
      taskPath: ".codex/tasks/0001-task.md",
      reportPath: ".codex/reports/0001-report.md",
      reportExists,
      instruction: "Do the task"
    },
    lastReportStatus: overrides.lastReportStatus ?? (reportExists ? "detected" : "missing"),
    directCodexLaunchSupported: false as const,
    limitations: [],
    codexCli: {
      command: "codex",
      found: true,
      execAvailable: true,
      directExecutionEnabled: true,
      sandbox: "workspace-write" as const,
      lastExitCode: overrides.lastExitCode,
      lastError: overrides.lastError
    },
    host: "host",
    pid: 1
  };
}
