import type { TaskStatus } from "./status.js";

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  taskPath: string;
  reportPath: string;
  createdAt: string;
  updatedAt: string;
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
