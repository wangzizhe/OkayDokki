import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { AuditRecord } from "../types.js";

const AUDIT_VERSION = "1.0";
const ALLOWED_EVENT_TYPES = new Set([
  "REQUEST",
  "RETRY",
  "APPROVE",
  "REJECT",
  "RUN",
  "PR_CREATED",
  "FAILED"
]);

type AuditRecordInput = Omit<AuditRecord, "auditVersion"> & Partial<Pick<AuditRecord, "auditVersion">>;

export class AuditLogger {
  private readonly filePath: string;

  constructor(filePath = config.auditLogPath) {
    this.filePath = path.resolve(filePath);
  }

  append(record: AuditRecordInput): void {
    const normalized: AuditRecord = {
      ...record,
      auditVersion: record.auditVersion ?? AUDIT_VERSION
    };
    this.validate(normalized);
    fs.appendFileSync(this.filePath, JSON.stringify(normalized) + "\n", "utf8");
  }

  private validate(record: AuditRecord): void {
    if (!record.auditVersion) {
      throw new Error("auditVersion is required");
    }
    if (!record.timestamp || Number.isNaN(Date.parse(record.timestamp))) {
      throw new Error("timestamp must be a valid ISO datetime");
    }
    if (!record.taskId) {
      throw new Error("taskId is required");
    }
    if (!record.triggerUser) {
      throw new Error("triggerUser is required");
    }
    if (!ALLOWED_EVENT_TYPES.has(record.eventType)) {
      throw new Error(`eventType is invalid: ${record.eventType}`);
    }
    if (
      record.approvalDecision !== undefined &&
      record.approvalDecision !== "APPROVE" &&
      record.approvalDecision !== "REJECT"
    ) {
      throw new Error(`approvalDecision is invalid: ${record.approvalDecision}`);
    }
    if (record.agentLogs !== undefined && !record.agentLogs.every((x) => typeof x === "string")) {
      throw new Error("agentLogs must be an array of strings");
    }
  }
}
