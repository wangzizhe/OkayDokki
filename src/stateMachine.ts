import { TaskStatus } from "./types.js";

const transitions: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ["WAIT_CLARIFY", "WAIT_APPROVE_WRITE", "FAILED"],
  WAIT_CLARIFY: ["WAIT_APPROVE_WRITE", "FAILED"],
  WAIT_APPROVE_WRITE: ["RUNNING", "FAILED"],
  RUNNING: ["PR_CREATED", "COMPLETED", "FAILED"],
  PR_CREATED: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: []
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}
