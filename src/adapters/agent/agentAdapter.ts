import { TaskSpec } from "../../types.js";

export interface AgentAdapter {
  buildCommand(task: TaskSpec): string;
}
