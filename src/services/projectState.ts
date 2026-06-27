import { readFile } from "node:fs/promises";
import { TaskStore } from "./taskStore.js";
import { GitService } from "./gitService.js";
import { ArchitectLog } from "./architectLog.js";
import { ensureRelativeInsideProject } from "../utils/paths.js";

export class ProjectStateService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly gitService = new GitService(),
    private readonly architectLog = new ArchitectLog()
  ) {}

  async getProjectState(projectPath: string): Promise<Record<string, unknown>> {
    const state = await this.taskStore.readState(projectPath);
    const git = await this.gitService.inspectDiff(projectPath, "summary");
    const reports = await Promise.all(
      state.tasks.map(async (task) => ({
        taskId: task.id,
        reportPath: task.reportPath,
        exists: await fileExists(ensureRelativeInsideProject(projectPath, task.reportPath))
      }))
    );

    return {
      tasks: state.tasks,
      gitStatus: git.status,
      reports,
      recentDecisions: await this.architectLog.recent(projectPath)
    };
  }

  async getTaskQueue(projectPath: string): Promise<Record<string, string>> {
    const state = await this.taskStore.readState(projectPath);
    const entries: Record<string, string> = {};

    for (const task of state.tasks) {
      entries[task.taskPath] = await readFile(ensureRelativeInsideProject(projectPath, task.taskPath), "utf8");
    }

    return entries;
  }

  async getArchitectLog(projectPath: string): Promise<string> {
    return this.architectLog.read(projectPath);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  return readFile(filePath)
    .then(() => true)
    .catch(() => false);
}
