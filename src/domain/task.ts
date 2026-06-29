import type { TaskStatus } from "./status.js";

export interface ReviewGateProvenance {
  decision: "APPROVABLE" | "NEEDS_REVIEW" | "BLOCKED";
  reviewReportPath: string;
  reviewHash: string;
  createdAt: string;
  changedFiles: string[];
  warnings: string[];
  errors: string[];
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  taskPath: string;
  reportPath: string;
  createdAt: string;
  updatedAt: string;
  lastReviewGate?: ReviewGateProvenance;
}

export interface CreateTaskData {
  title: string;
  goal: string;
  context?: string;
  scope?: string[];
  outOfScope?: string[];
  filesAllowed?: string[];
  acceptanceCriteria?: string[];
  requiredChecks?: string[];
  notes?: string;
  policyNotes?: string[];
}

export interface CreateTaskInput {
  projectPath: string;
  title: string;
  goal: string;
  context?: string;
  scope?: string[];
  outOfScope?: string[];
  filesAllowed?: string[];
  acceptanceCriteria?: string[];
  requiredChecks?: string[];
  notes?: string;
  policyNotes?: string[];
}

export interface TaskState {
  tasks: TaskRecord[];
}
