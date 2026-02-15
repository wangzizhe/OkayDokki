import { randomUUID } from "node:crypto";

export function newTaskId(): string {
  return randomUUID();
}

