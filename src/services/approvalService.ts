import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { TaskStore } from "./taskStore.js";
import { ProjectPolicyService } from "./projectPolicy.js";
import { ReviewGateService, type ReviewGateDecision } from "./reviewGate.js";
import { safeExec } from "../utils/safeExec.js";
import { ensureRelativeInsideProject } from "../utils/paths.js";

export interface ApprovalRequest {
  projectPath: string;
  taskId: string;
  decision: string;
  overrideReviewGate?: boolean;
  force?: boolean;
  forceReason?: string;
}

export interface ApprovalResult {
  taskId: string;
  status: "approved";
  reviewGate: {
    strict: boolean;
    decision: ReviewGateDecision;
    reviewHash?: string;
    reviewReportPath?: string;
  };
  warnings: string[];
}

export class ApprovalService {
  constructor(
    private readonly taskStore = new TaskStore(),
    private readonly policyService = new ProjectPolicyService(),
    private readonly reviewGateService = new ReviewGateService()
  ) {}

  async approve(input: ApprovalRequest): Promise<ApprovalResult> {
    const root = path.resolve(input.projectPath);
    const policy = await this.policyService.readPolicy(root).then((result) => result.policy).catch(() => undefined);
    const strict = policy?.workflow.strictReviewGate ?? false;
    const warnings: string[] = [];

    let reviewDecision: ReviewGateDecision;
    let reviewHash: string | undefined;
    let reviewReportPath: string | undefined;
    let reviewReason: string | undefined;

    if (strict) {
      const provenance = await this.validateStrictReviewProvenance(root, input.taskId, policy?.workflow.maxReviewAgeMinutes ?? 60, policy?.workflow.requireCleanGitForApprove ?? false);
      reviewDecision = provenance.decision;
      reviewHash = provenance.reviewHash;
      reviewReportPath = provenance.reviewReportPath;
      reviewReason = provenance.reason;

      if (reviewDecision === "BLOCKED" && !input.force) {
        throw new Error(reviewReason ?? "Review Gate approval is required before approve_task.");
      }

      if (reviewDecision === "BLOCKED" && input.force && !input.forceReason?.trim()) {
        throw new Error("forceReason is required when force approving a BLOCKED task.");
      }

      if (reviewDecision === "NEEDS_REVIEW" && !input.overrideReviewGate && !input.force) {
        throw new Error(reviewReason ?? "Review Gate requires manual review before approval.");
      }
    } else {
      const review = await this.reviewGateService.run({
        projectPath: root,
        taskId: input.taskId,
        checks: ["git status --short"],
        requireReport: true
      });
      reviewDecision = review.decision;
      reviewHash = review.reviewHash;
      reviewReportPath = review.reviewReportPath;

      if (reviewDecision === "BLOCKED" && !input.force) {
        throw new Error(`Review Gate blocked approval: ${review.errors.join("; ")}`);
      }

      if (reviewDecision === "BLOCKED" && input.force && !input.forceReason?.trim()) {
        throw new Error("forceReason is required when force approving a BLOCKED task.");
      }

      if (reviewDecision === "NEEDS_REVIEW" && !input.overrideReviewGate && !input.force) {
        throw new Error("Review Gate requires manual review before approval.");
      }
    }

    const overrideNote =
      reviewDecision === "NEEDS_REVIEW" && (input.overrideReviewGate || input.force)
        ? "\n\nReview Gate override used."
        : "";
    const forceNote =
      reviewDecision === "BLOCKED" && input.force
        ? `\n\nFORCE APPROVAL REASON:\n${input.forceReason?.trim()}`
        : "";
    if (input.force) {
      warnings.push("Task was force-approved despite Review Gate BLOCKED decision.");
    }

    const task = await this.taskStore.approveTask(root, input.taskId, `${input.decision}${overrideNote}${forceNote}`);
    return {
      taskId: task.id,
      status: "approved",
      reviewGate: {
        strict,
        decision: reviewDecision,
        reviewHash,
        reviewReportPath
      },
      warnings
    };
  }

  async validateStrictReviewProvenance(
    projectPath: string,
    taskId: string,
    maxReviewAgeMinutes: number,
    requireCleanGitForApprove: boolean
  ): Promise<{ decision: ReviewGateDecision; reviewHash?: string; reviewReportPath?: string; reason?: string }> {
    const task = await this.taskStore.getTask(projectPath, taskId);
    const provenance = task.lastReviewGate;

    if (!provenance) {
      return {
        decision: "BLOCKED",
        reason: "Review Gate approval is required before approve_task. Run review_gate with writeReport: true."
      };
    }

    const absoluteReportPath = ensureRelativeInsideProject(projectPath, provenance.reviewReportPath);
    const reportContent = await readFile(absoluteReportPath, "utf8").catch(() => undefined);
    if (!reportContent) {
      return {
        decision: "BLOCKED",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored review report is missing. Run review_gate with writeReport: true."
      };
    }

    const actualHash = `sha256:${createHash("sha256").update(reportContent).digest("hex")}`;
    if (actualHash !== provenance.reviewHash) {
      return {
        decision: "BLOCKED",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored Review Gate hash does not match the review report."
      };
    }

    if (!isReviewReportForTask(reportContent, taskId)) {
      return {
        decision: "BLOCKED",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored Review Gate report does not belong to the approved task."
      };
    }

    const decisionInReport = readDecisionFromReviewReport(reportContent);
    if (decisionInReport !== provenance.decision) {
      return {
        decision: "BLOCKED",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored Review Gate decision does not match the saved provenance."
      };
    }

    const createdAt = new Date(provenance.createdAt);
    const maxAgeMs = maxReviewAgeMinutes * 60 * 1000;
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > maxAgeMs) {
      return {
        decision: "NEEDS_REVIEW",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored Review Gate result is stale and must be refreshed."
      };
    }

    if (requireCleanGitForApprove) {
      const gitStatus = await safeExec(projectPath, "git status --short", { maxOutputBytes: 20_000 });
      if (gitStatus.exitCode !== 0 || gitStatus.stdout.trim().length > 0) {
        return {
          decision: "BLOCKED",
          reviewHash: provenance.reviewHash,
          reviewReportPath: provenance.reviewReportPath,
          reason: "Git working tree must be clean before approve_task in strict workflow mode."
        };
      }
    }

    if (provenance.decision === "APPROVABLE") {
      return {
        decision: "APPROVABLE",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath
      };
    }

    if (provenance.decision === "NEEDS_REVIEW") {
      return {
        decision: "NEEDS_REVIEW",
        reviewHash: provenance.reviewHash,
        reviewReportPath: provenance.reviewReportPath,
        reason: "Stored Review Gate result requires manual review."
      };
    }

    return {
      decision: "BLOCKED",
      reviewHash: provenance.reviewHash,
      reviewReportPath: provenance.reviewReportPath,
      reason: "Stored Review Gate result is BLOCKED."
    };
  }
}

function isReviewReportForTask(markdown: string, taskId: string): boolean {
  return new RegExp(`^# Review Gate for Task ${escapeRegExp(taskId)}\\b`, "m").test(markdown);
}

function readDecisionFromReviewReport(markdown: string): ReviewGateDecision | undefined {
  const match = markdown.match(/^## Decision\s+([A-Z_]+)\s*$/m);
  if (!match) {
    return undefined;
  }

  if (match[1] === "APPROVABLE" || match[1] === "NEEDS_REVIEW" || match[1] === "BLOCKED") {
    return match[1];
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
