import { SqliteDb } from "../db.js";
import { DeliveryStrategy } from "../types.js";

type PrefRow = {
  delivery_strategy: string;
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
      INSERT INTO user_preferences (chat_id, user_id, delivery_strategy, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id, user_id)
      DO UPDATE SET delivery_strategy = excluded.delivery_strategy, updated_at = excluded.updated_at
    `
      )
      .run(chatId, userId, strategy, new Date().toISOString());
  }

  clearStrategy(chatId: string, userId: string): void {
    this.db
      .prepare("DELETE FROM user_preferences WHERE chat_id = ? AND user_id = ?")
      .run(chatId, userId);
  }
}
