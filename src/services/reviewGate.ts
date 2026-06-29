import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { TaskStore } from "./taskStore.js";
import { ProjectPolicyService } from "./projectPolicy.js";
import { DoctorService } from "./doctor.js";
import { TestRunner } from "./testRunner.js";
import { getCodexPaths, toProjectRelative } from "../utils/paths.js";

export type ReviewGateDecision = "APPROVABLE" | "NEEDS_REVIEW" | "BLOCKED";
export type ReviewGateCheckStatus = "pass" | "warn" | "fail";
export type ReviewGateRecommendedAction = "approve_task" | "manual_review" | "reject_task";

export interface ReviewGateCheck {
  name: string;
  status: ReviewGateCheckStatus;
  details?: string;
}

export interface ReviewGateOptions {
  projectPath: string;
  taskId: string;
  checks?: string[];
  requireReport?: boolean;
  requireCleanForbiddenPaths?: boolean;
  writeReport?: boolean;
}

export interface ReviewGateResult {
  taskId: string;
  decision: ReviewGateDecision;
  summary: string;
  checks: ReviewGateCheck[];
  changedFiles: string[];
  warnings: string[];
  errors: string[];
  manualApprovalRequired: boolean;
  recommendedAction: ReviewGateRecommendedAction;
  reviewReportPath?: string;
}

export class ReviewGateService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly policyService = new ProjectPolicyService(),
    private readonly doctorService = new DoctorService(),
    private readonly testRunner = new TestRunner()
  ) {}

  async run(options: ReviewGateOptions): Promise<ReviewGateResult> {
    const root = path.resolve(options.projectPath);
    const requireReport = options.requireReport ?? true;
    const requireCleanForbiddenPaths = options.requireCleanForbiddenPaths ?? true;
    const checks: ReviewGateCheck[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let manualApprovalRequired = false;
    let changedFiles: string[] = [];

    const task = await this.taskStore.getTask(root, options.taskId).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    });

    if (task) {
      if (task.status === "reported" || task.status === "pending") {
        checks.push(pass("task_status", task.status));
      } else {
        checks.push(warn("task_status", task.status));
        warnings.push(`Task status is ${task.status}; expected reported or pending with report.`);
      }
    } else {
      checks.push(fail("task_status", "Task not found."));
    }

    if (requireReport && task) {
      const report = await this.taskStore.readReport(root, options.taskId).catch(() => undefined);
      if (report) {
        checks.push(pass("report_exists", task.reportPath));
      } else {
        checks.push(fail("report_exists", "Report is required but missing."));
        errors.push("Report is required but missing.");
      }
    } else if (!requireReport) {
      checks.push(warn("report_exists", "Report was not required."));
    }

    const diffValidation = await this.policyService.validateDiffAgainstPolicy(root).catch((error: unknown) => {
      errors.push(error instanceof Error ? error.message : String(error));
      return undefined;
    });
    if (diffValidation) {
      changedFiles = diffValidation.changedFiles;
      manualApprovalRequired = manualApprovalRequired || diffValidation.manualApprovalRequired;
      checks.push(diffValidation.valid ? pass("policy_diff_validation", "valid") : fail("policy_diff_validation", diffValidation.errors.join("; ")));
      warnings.push(...diffValidation.warnings);
      errors.push(...diffValidation.errors);
    } else {
      checks.push(fail("policy_diff_validation", "Policy diff validation failed."));
    }

    if (requireCleanForbiddenPaths) {
      const forbidden = await this.doctorService.forbiddenTrackedPaths(root);
      if (forbidden.length === 0) {
        checks.push(pass("forbidden_tracked_paths", "clean"));
      } else {
        checks.push(fail("forbidden_tracked_paths", forbidden.join(", ")));
        errors.push(`Forbidden paths are tracked: ${forbidden.join(", ")}`);
      }
    }

    const requestedChecks = options.checks ?? [];
    if (requestedChecks.length === 0) {
      checks.push(warn("required_checks", "No checks were provided."));
      warnings.push("No checks were provided.");
    } else {
      const run = await this.testRunner.run(root, requestedChecks).catch((error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error));
        return undefined;
      });

      if (run) {
        for (const result of run.results) {
          if (result.exitCode === 0) {
            checks.push(pass(`check: ${result.command}`, "exit code 0"));
          } else {
            checks.push(fail(`check: ${result.command}`, result.stderr || result.stdout || `exit code ${result.exitCode}`));
            errors.push(`Required check failed: ${result.command}`);
          }
        }
      }
    }

    const decision = errors.length > 0 ? "BLOCKED" : warnings.length > 0 || manualApprovalRequired ? "NEEDS_REVIEW" : "APPROVABLE";
    const result: ReviewGateResult = {
      taskId: options.taskId,
      decision,
      summary: summaryFor(decision),
      checks,
      changedFiles,
      warnings: unique(warnings),
      errors: unique(errors),
      manualApprovalRequired,
      recommendedAction: decision === "APPROVABLE" ? "approve_task" : decision === "NEEDS_REVIEW" ? "manual_review" : "reject_task"
    };

    if (options.writeReport) {
      result.reviewReportPath = await this.writeReport(root, result);
    }

    return result;
  }

  private async writeReport(projectPath: string, result: ReviewGateResult): Promise<string> {
    const paths = getCodexPaths(projectPath);
    await mkdir(paths.reportsDir, { recursive: true });
    const reportPath = path.join(paths.reportsDir, `${result.taskId}-review.md`);
    await writeFile(reportPath, renderReviewReport(result), "utf8");
    return toProjectRelative(projectPath, reportPath);
  }
}

export function formatReviewGateText(result: ReviewGateResult): string {
  return [
    `Review Gate for Task ${result.taskId}`,
    "",
    `Decision: ${result.decision}`,
    `Summary: ${result.summary}`,
    `Recommended action: ${result.recommendedAction}`,
    `Manual approval required: ${result.manualApprovalRequired ? "yes" : "no"}`,
    "",
    "Checks:",
    ...result.checks.map((check) => `- [${check.status.toUpperCase()}] ${check.name}${check.details ? ` - ${check.details}` : ""}`),
    "",
    "Changed files:",
    ...listOrNone(result.changedFiles),
    "",
    "Warnings:",
    ...listOrNone(result.warnings),
    "",
    "Errors:",
    ...listOrNone(result.errors),
    result.reviewReportPath ? `\nReview report: ${result.reviewReportPath}` : undefined
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function renderReviewReport(result: ReviewGateResult): string {
  return [
    `# Review Gate for Task ${result.taskId}`,
    "",
    "## Decision",
    "",
    result.decision,
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Checks",
    "",
    ...result.checks.map((check) => `- ${check.name} - ${check.status}${check.details ? ` - ${check.details}` : ""}`),
    "",
    "## Changed Files",
    "",
    ...listOrNone(result.changedFiles),
    "",
    "## Policy Validation",
    "",
    `Manual approval required: ${result.manualApprovalRequired ? "yes" : "no"}`,
    "",
    "## Warnings",
    "",
    ...listOrNone(result.warnings),
    "",
    "## Errors",
    "",
    ...listOrNone(result.errors),
    "",
    "## Recommended Action",
    "",
    result.recommendedAction,
    ""
  ].join("\n");
}

function pass(name: string, details?: string): ReviewGateCheck {
  return { name, status: "pass", details };
}

function warn(name: string, details?: string): ReviewGateCheck {
  return { name, status: "warn", details };
}

function fail(name: string, details?: string): ReviewGateCheck {
  return { name, status: "fail", details };
}

function summaryFor(decision: ReviewGateDecision): string {
  if (decision === "APPROVABLE") {
    return "Task can be approved.";
  }

  if (decision === "NEEDS_REVIEW") {
    return "Task needs manual review before approval.";
  }

  return "Task is blocked and should not be approved without force reason.";
}

function listOrNone(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ["- none"];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
