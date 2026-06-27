export const taskStatuses = [
  "pending",
  "in_progress",
  "reported",
  "approved",
  "rejected",
  "archived"
] as const;

export type TaskStatus = (typeof taskStatuses)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return taskStatuses.includes(value as TaskStatus);
}
