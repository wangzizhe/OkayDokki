import { SqliteDb } from "../db.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

type ChatMessageRow = {
  role: string;
  content: string;
  created_at: string;
};

export class ChatMemoryRepository {
  constructor(private readonly db: SqliteDb) {}

  append(chatId: string, userId: string, repo: string, role: "user" | "assistant", content: string): void {
    this.db
      .prepare(
        `
      INSERT INTO chat_messages (chat_id, user_id, repo, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
      )
      .run(chatId, userId, repo, role, content, new Date().toISOString());
  }

  listRecent(chatId: string, userId: string, limit: number): ChatMessage[] {
    const safeLimit = Math.max(1, Math.min(limit, 50));
    const rows = this.db
      .prepare(
        `
      SELECT role, content, created_at
      FROM chat_messages
      WHERE chat_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `
      )
      .all(chatId, userId, safeLimit) as ChatMessageRow[];

    return rows
      .reverse()
      .map((row) => ({
        role: row.role === "assistant" ? "assistant" : "user",
        content: row.content
      }));
  }

  clear(chatId: string, userId: string): void {
    this.db
      .prepare(
        `
      DELETE FROM chat_messages
      WHERE chat_id = ? AND user_id = ?
    `
      )
      .run(chatId, userId);
  }
}
