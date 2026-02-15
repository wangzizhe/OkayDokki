export type TaskStatus =
  | "CREATED"
  | "WAIT_CLARIFY"
  | "WAIT_APPROVE_WRITE"
  | "RUNNING"
  | "PR_CREATED"
  | "COMPLETED"
  | "FAILED";

export type EventType =
  | "REQUEST"
  | "RETRY"
  | "APPROVE"
  | "REJECT"
  | "RUN"
  | "PR_CREATED"
  | "FAILED";

export interface Source {
  im: "telegram" | "api";
}

export interface TaskSpec {
  taskId: string;
  source: Source;
  triggerUser: string;
  repo: string;
  branch: string;
  intent: string;
  agent: string;
  status: TaskStatus;
  createdAt: string;
  approvedBy: string | null;
}

export interface AgentResult {
  diff: string;
  logs: string[];
  meta: Record<string, string>;
}

export interface TaskRunResult {
  testsResult: string;
  diffHash: string;
  agentLogs: string[];
  agentMeta: Record<string, string>;
  prLink: string | null;
}

export interface AuditRecord {
  auditVersion: string;
  timestamp: string;
  taskId: string;
  triggerUser: string;
  eventType: EventType;
  diffHash?: string;
  agentLogs?: string[];
  approvalDecision?: "APPROVE" | "REJECT";
  testsResult?: string;
  prLink?: string;
  message?: string;
}
