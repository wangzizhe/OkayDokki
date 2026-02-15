import { TaskSpec, TaskStatus } from "../types.js";
import { assertTransition } from "../stateMachine.js";
import { SqliteDb } from "../db.js";

type TaskRow = {
  task_id: string;
  source_im: string;
  trigger_user: string;
  repo: string;
  branch: string;
  intent: string;
  agent: string;
  status: TaskStatus;
  created_at: string;
  approved_by: string | null;
};

export class TaskRepository {
  constructor(private readonly db: SqliteDb) {}

  create(task: TaskSpec): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        task_id, source_im, trigger_user, repo, branch, intent, agent, status, created_at, approved_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.taskId,
      task.source.im,
      task.triggerUser,
      task.repo,
      task.branch,
      task.intent,
      task.agent,
      task.status,
      task.createdAt,
      task.approvedBy
    );
  }

  get(taskId: string): TaskSpec | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId) as TaskRow | undefined;
    return row ? this.toTask(row) : null;
  }

  listRecent(limit: number): TaskSpec[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
      .all(limit) as TaskRow[];
    return rows.map((row) => this.toTask(row));
  }

  transition(taskId: string, nextStatus: TaskStatus, approvedBy?: string): TaskSpec {
    const current = this.get(taskId);
    if (!current) {
      throw new Error(`Task not found: ${taskId}`);
    }
    assertTransition(current.status, nextStatus);

    this.db
      .prepare("UPDATE tasks SET status = ?, approved_by = COALESCE(?, approved_by) WHERE task_id = ?")
      .run(nextStatus, approvedBy ?? null, taskId);

    const updated = this.get(taskId);
    if (!updated) {
      throw new Error(`Task missing after update: ${taskId}`);
    }
    return updated;
  }

  private toTask(row: TaskRow): TaskSpec {
    return {
      taskId: row.task_id,
      source: { im: row.source_im as "telegram" | "api" },
      triggerUser: row.trigger_user,
      repo: row.repo,
      branch: row.branch,
      intent: row.intent,
      agent: row.agent,
      status: row.status,
      createdAt: row.created_at,
      approvedBy: row.approved_by
    };
  }
}
