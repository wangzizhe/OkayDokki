import { SqliteDb } from "../db.js";
import { DeliveryStrategy } from "../types.js";

type PrefRow = {
  delivery_strategy: string;
  auto_chain?: number;
};

export class UserPreferenceRepository {
  constructor(private readonly db: SqliteDb) {}

  getStrategy(chatId: string, userId: string): DeliveryStrategy | null {
    const row = this.db
      .prepare("SELECT delivery_strategy FROM user_preferences WHERE chat_id = ? AND user_id = ?")
      .get(chatId, userId) as PrefRow | undefined;
    if (!row) {
      return null;
    }
    return row.delivery_strategy === "isolated" ? "isolated" : "rolling";
  }

  setStrategy(chatId: string, userId: string, strategy: DeliveryStrategy): void {
    this.db
      .prepare(
        `
      INSERT INTO user_preferences (chat_id, user_id, delivery_strategy, auto_chain, updated_at)
      VALUES (?, ?, ?, COALESCE((SELECT auto_chain FROM user_preferences WHERE chat_id = ? AND user_id = ?), 0), ?)
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET delivery_strategy = excluded.delivery_strategy, updated_at = excluded.updated_at
    `
      )
      .run(chatId, userId, strategy, chatId, userId, new Date().toISOString());
  }

  clearStrategy(chatId: string, userId: string): void {
    this.db
      .prepare(
        `
      INSERT INTO user_preferences (chat_id, user_id, delivery_strategy, auto_chain, updated_at)
      VALUES (?, ?, 'rolling', COALESCE((SELECT auto_chain FROM user_preferences WHERE chat_id = ? AND user_id = ?), 0), ?)
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET delivery_strategy = 'rolling', updated_at = excluded.updated_at
    `
      )
      .run(chatId, userId, chatId, userId, new Date().toISOString());
  }

  getAutoChain(chatId: string, userId: string): boolean {
    const row = this.db
      .prepare("SELECT auto_chain FROM user_preferences WHERE chat_id = ? AND user_id = ?")
      .get(chatId, userId) as PrefRow | undefined;
    return (row?.auto_chain ?? 0) === 1;
  }

  setAutoChain(chatId: string, userId: string, enabled: boolean): void {
    this.db
      .prepare(
        `
      INSERT INTO user_preferences (chat_id, user_id, delivery_strategy, auto_chain, updated_at)
      VALUES (
        ?, ?,
        COALESCE((SELECT delivery_strategy FROM user_preferences WHERE chat_id = ? AND user_id = ?), 'rolling'),
        ?, ?
      )
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET auto_chain = excluded.auto_chain, updated_at = excluded.updated_at
    `
      )
      .run(chatId, userId, chatId, userId, enabled ? 1 : 0, new Date().toISOString());
  }
}
