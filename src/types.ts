export type TaskStatus =
  | "CREATED"
  | "WAIT_CLARIFY"
  | "WAIT_APPROVE_WRITE"
  | "RUNNING"
  | "PR_CREATED"
  | "COMPLETED"
  | "FAILED";

export type DeliveryStrategy = "rolling" | "isolated";

export type EventType =
  | "REQUEST"
  | "RETRY"
  | "APPROVE"
  | "REJECT"
  | "RUN"
  | "PR_CREATED"
  | "FAILED"
  | "CHAT_REQUEST"
  | "CHAT_RESPONSE"
  | "CHAT_FAILED";

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
  deliveryStrategy?: DeliveryStrategy;
  baseBranch?: string;
}

export interface AgentResult {
  diff: string;
  logs: string[];
  meta: Record<string, string>;
}

export interface TaskRunResult {
  testsResult: string;
  testLog: string;
  diffHash: string;
  hasDiff: boolean;
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
  errorCode?: string;
  diffHash?: string;
  agentLogs?: string[];
  approvalDecision?: "APPROVE" | "REJECT";
  testsResult?: string;
  prLink?: string;
  message?: string;
}
