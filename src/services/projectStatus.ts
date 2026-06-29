import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { TaskRecord } from "../domain/task.js";
import { taskStatuses, type TaskStatus } from "../domain/status.js";
import { getCodexPaths, toProjectRelative } from "../utils/paths.js";
import { safeExec } from "../utils/safeExec.js";
import { DoctorService, type DoctorResult } from "./doctor.js";
import { ProjectPolicyService } from "./projectPolicy.js";
import { SmokeRunner, type SmokeResult } from "./smokeRunner.js";
import { TaskStore } from "./taskStore.js";

export type ProjectRecommendedAction =
  | "fix_blockers"
  | "wait_for_codex_or_request_report"
  | "run_review_gate"
  | "rerun_review_gate"
  | "approve_task"
  | "commit_changes"
  | "create_next_task"
  | "create_task";

export interface ProjectStatusOptions {
  projectPath: string;
  includeSmoke?: boolean;
  includeDoctor?: boolean;
  includeReview?: boolean;
  taskId?: string;
}

export interface ProjectStatusResult {
  projectPath: string;
  projectName: string;
  git: {
    isRepo: boolean;
    status: "clean" | "dirty" | "unknown";
    changedFiles: string[];
  };
  policy: {
    exists: boolean;
    defaultProfile?: string;
    defaultSmokeMode?: string;
    strictReviewGate: boolean;
  };
  doctor?: {
    result: DoctorResult["result"];
    warnings: string[];
  };
  smoke?: {
    result: SmokeResult["result"];
    warnings: string[];
    reportPath?: string;
  };
  tasks: {
    total: number;
    pending: number;
    reported: number;
    approved: number;
    rejected: number;
    archived: number;
    latest?: {
      id: string;
      title: string;
      status: TaskStatus;
    };
  };
  reports: {
    latestTaskReport?: string;
    latestReviewReport?: string;
    latestSmokeReport?: string;
  };
  review?: {
    exists: boolean;
    latestDecision?: "APPROVABLE" | "NEEDS_REVIEW" | "BLOCKED";
    lastReviewHash?: string;
    reviewReportPath?: string;
    createdAt?: string;
    validUntil?: string;
    expired: boolean;
  };
  recommendedAction: ProjectRecommendedAction;
  warnings: string[];
  errors: string[];
}

export class ProjectStatusService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly policyService = new ProjectPolicyService(),
    private readonly doctorService = new DoctorService(),
    private readonly smokeRunner = new SmokeRunner()
  ) {}

  async check(options: ProjectStatusOptions): Promise<ProjectStatusResult> {
    const root = path.resolve(options.projectPath);
    const warnings: string[] = [];
    const errors: string[] = [];
    const git = await readGitStatus(root);
    const policyResult = await this.policyService.readPolicy(root).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    });
    const policy = policyResult?.policy;
    warnings.push(...(policyResult?.warnings ?? []), ...(policyResult?.errors ?? []));

    const state = await this.taskStore.readState(root).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return { tasks: [] };
    });
    const latestTask = options.taskId ? state.tasks.find((task) => task.id === options.taskId) : state.tasks.at(-1);
    if (options.taskId && !latestTask) {
      errors.push(`Task not found: ${options.taskId}`);
    }

    const doctor = options.includeDoctor ?? true
      ? await this.doctorService.run({ projectPath: root }).catch((error: unknown) => {
          errors.push(error instanceof Error ? error.message : String(error));
          return undefined;
        })
      : undefined;

    const smoke = options.includeSmoke
      ? await this.smokeRunner.run(root).catch((error: unknown) => {
          errors.push(error instanceof Error ? error.message : String(error));
          return undefined;
        })
      : undefined;
    const paths = getCodexPaths(root);
    const latestSmokeReport = smoke?.reportPath ?? (await latestFile(paths.root, path.join(paths.codexDir, "smoke", "reports"), ".md"));
    const selectedTaskReport = latestTask && (await exists(path.join(root, latestTask.reportPath))) ? latestTask.reportPath : undefined;
    const review = options.includeReview ?? true ? buildReview(latestTask, policy?.workflow.maxReviewAgeMinutes ?? 60) : undefined;
    const latestReviewReport = review?.reviewReportPath ?? (await latestFile(paths.root, paths.reportsDir, "-review.md"));
    const counts = countTasks(state.tasks);

    if (git.status === "unknown") {
      errors.push("Git status is not readable.");
    }

    const result: ProjectStatusResult = {
      projectPath: root,
      projectName: policy?.projectName ?? path.basename(root),
      git,
      policy: {
        exists: Boolean(policyResult?.exists && policy),
        defaultProfile: policy?.defaultProfile,
        defaultSmokeMode: policy?.defaultSmokeMode,
        strictReviewGate: policy?.workflow.strictReviewGate ?? false
      },
      doctor: doctor
        ? {
            result: doctor.result,
            warnings: doctor.warnings
          }
        : undefined,
      smoke: smoke
        ? {
            result: smoke.result,
            warnings: smoke.checks.filter((check) => check.status === "warn").map((check) => `${check.name}: ${check.details}`),
            reportPath: smoke.reportPath
          }
        : undefined,
      tasks: {
        ...counts,
        latest: latestTask ? { id: latestTask.id, title: latestTask.title, status: latestTask.status } : undefined
      },
      reports: {
        latestTaskReport: selectedTaskReport,
        latestReviewReport,
        latestSmokeReport
      },
      review,
      recommendedAction: "create_task",
      warnings: unique(warnings),
      errors: unique(errors)
    };

    result.recommendedAction = recommend(result, latestTask, Boolean(selectedTaskReport));
    return result;
  }
}

export function formatProjectStatusText(status: ProjectStatusResult): string {
  const policyLabel = status.policy.exists
    ? `${status.policy.defaultProfile ?? "default"} / ${status.policy.defaultSmokeMode ?? "ephemeral"} / strict review ${status.policy.strictReviewGate ? "enabled" : "disabled"}`
    : "missing";
  const gitLabel = status.git.status === "clean" ? "[PASS] clean" : status.git.status === "dirty" ? `[WARN] dirty (${status.git.changedFiles.length} files)` : "[FAIL] unknown";
  const lines = [
    `Project Status: ${status.projectName}`,
    "",
    "Git:",
    gitLabel,
    ...(status.git.changedFiles.length ? status.git.changedFiles.map((file) => `- ${file}`) : []),
    "",
    "Policy:",
    `${status.policy.exists ? "[PASS]" : "[WARN]"} ${policyLabel}`,
    "",
    "Doctor:",
    status.doctor ? `${status.doctor.result === "READY" ? "[PASS]" : status.doctor.result === "READY_WITH_WARNINGS" ? "[WARN]" : "[FAIL]"} ${status.doctor.result}` : "[WARN] skipped",
    ...list(status.doctor?.warnings ?? []),
    "",
    "Tasks:",
    `approved: ${status.tasks.approved}`,
    `pending: ${status.tasks.pending}`,
    `reported: ${status.tasks.reported}`,
    `rejected: ${status.tasks.rejected}`,
    `archived: ${status.tasks.archived}`,
    "",
    "Latest task:",
    status.tasks.latest ? `${status.tasks.latest.id} ${status.tasks.latest.title} - ${status.tasks.latest.status}` : "none",
    "",
    "Reports:",
    `latest task report: ${status.reports.latestTaskReport ?? "none"}`,
    `latest review report: ${status.reports.latestReviewReport ?? "none"}`,
    `latest smoke report: ${status.reports.latestSmokeReport ?? "none"}`,
    "",
    "Review:",
    status.review?.exists ? `last decision: ${status.review.latestDecision}` : "last decision: none",
    status.review?.lastReviewHash ? `review hash: ${status.review.lastReviewHash}` : "review hash: none",
    status.review?.validUntil ? `valid until: ${status.review.validUntil}` : "valid until: none",
    status.review ? `expired: ${status.review.expired ? "yes" : "no"}` : "expired: n/a",
    "",
    "Recommended next action:",
    status.recommendedAction
  ];

  if (status.warnings.length) {
    lines.push("", "Warnings:", ...status.warnings.map((warning) => `- ${warning}`));
  }

  if (status.errors.length) {
    lines.push("", "Errors:", ...status.errors.map((error) => `- ${error}`));
  }

  return lines.join("\n");
}

function recommend(status: ProjectStatusResult, latestTask: TaskRecord | undefined, reportExists: boolean): ProjectRecommendedAction {
  if (status.errors.length > 0 || status.doctor?.result === "NOT_READY") {
    return "fix_blockers";
  }

  if (!latestTask) {
    return "create_task";
  }

  if (status.review?.expired) {
    return "rerun_review_gate";
  }

  if ((latestTask.status === "pending" || latestTask.status === "reported") && !reportExists) {
    return "wait_for_codex_or_request_report";
  }

  if (reportExists && !status.review?.exists && latestTask.status !== "approved") {
    return "run_review_gate";
  }

  if (status.review?.latestDecision === "APPROVABLE" && latestTask.status !== "approved") {
    return "approve_task";
  }

  if (latestTask.status === "approved" && status.git.status === "dirty") {
    return "commit_changes";
  }

  if (latestTask.status === "approved" && status.git.status === "clean") {
    return "create_next_task";
  }

  return "create_task";
}

function buildReview(task: TaskRecord | undefined, maxReviewAgeMinutes: number): ProjectStatusResult["review"] {
  const provenance = task?.lastReviewGate;
  if (!provenance) {
    return {
      exists: false,
      expired: false
    };
  }

  const createdAt = new Date(provenance.createdAt);
  const validUntil = new Date(createdAt);
  validUntil.setMinutes(validUntil.getMinutes() + maxReviewAgeMinutes);

  return {
    exists: true,
    latestDecision: provenance.decision,
    lastReviewHash: provenance.reviewHash,
    reviewReportPath: provenance.reviewReportPath,
    createdAt: provenance.createdAt,
    validUntil: validUntil.toISOString(),
    expired: Date.now() > validUntil.getTime()
  };
}

async function readGitStatus(projectPath: string): Promise<ProjectStatusResult["git"]> {
  const isRepo = await safeExec(projectPath, "git rev-parse --is-inside-work-tree", { maxOutputBytes: 1_000 });
  if (isRepo.exitCode !== 0 || isRepo.stdout.trim() !== "true") {
    return {
      isRepo: false,
      status: "unknown",
      changedFiles: []
    };
  }

  const status = await safeExec(projectPath, "git status --short", { maxOutputBytes: 80_000 });
  if (status.exitCode !== 0) {
    return {
      isRepo: true,
      status: "unknown",
      changedFiles: []
    };
  }

  const changedFiles = status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[ MARCUD?!]{1,2}\s+/, "").trim())
    .sort();

  return {
    isRepo: true,
    status: changedFiles.length ? "dirty" : "clean",
    changedFiles
  };
}

function countTasks(tasks: TaskRecord[]): Omit<ProjectStatusResult["tasks"], "latest"> {
  const counts: Record<TaskStatus, number> = Object.fromEntries(taskStatuses.map((status) => [status, 0])) as Record<TaskStatus, number>;
  for (const task of tasks) {
    counts[task.status] += 1;
  }

  return {
    total: tasks.length,
    pending: counts.pending,
    reported: counts.reported,
    approved: counts.approved,
    rejected: counts.rejected,
    archived: counts.archived
  };
}

async function latestFile(projectPath: string, directory: string, suffix: string): Promise<string | undefined> {
  const entries = await readdir(directory).catch(() => []);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(suffix))
      .map(async (entry) => {
        const filePath = path.join(directory, entry);
        const info = await stat(filePath).catch(() => undefined);
        return info?.isFile() ? { filePath, mtimeMs: info.mtimeMs } : undefined;
      })
  );
  const latest = files
    .filter((file): file is { filePath: string; mtimeMs: number } => Boolean(file))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];

  return latest ? toProjectRelative(projectPath, latest.filePath) : undefined;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath)
    .then(() => true)
    .catch(() => false);
}

function list(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
