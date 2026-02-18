import express from "express";
import { IMAdapter, InlineButton } from "./imAdapter.js";

type Update = {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { id: number };
  };
  callback_query?: {
    data?: string;
    from: { id: number };
    message?: { chat: { id: number } };
    id: string;
  };
};

type TaskHandler = (chatId: string, userId: string, text: string) => Promise<void>;
type CallbackHandler = (chatId: string, userId: string, data: string) => Promise<void>;

export class TelegramAdapter implements IMAdapter {
  private taskHandler: TaskHandler | null = null;
  private callbackHandler: CallbackHandler | null = null;
  private polling = false;
  private stopRequested = false;
  private updateOffset = 0;

  constructor(private readonly token: string, private readonly secret?: string) {}

  onTaskCommand(handler: TaskHandler): void {
    this.taskHandler = handler;
  }

  onCallback(handler: CallbackHandler): void {
    this.callbackHandler = handler;
  }

  mountWebhook(path: string): express.RequestHandler {
    if (!this.secret) {
      throw new Error("TELEGRAM_WEBHOOK_SECRET is required for webhook mode.");
    }
    const router = express.Router();
    router.post(path, express.json(), async (req, res) => {
      const secret = req.header("x-telegram-bot-api-secret-token");
      if (secret !== this.secret) {
        res.status(401).send("unauthorized");
        return;
      }

      const update = req.body as Update;
      await this.handleUpdate(update);
      res.status(200).send("ok");
    });
    return router;
  }

  startPolling(): void {
    if (this.polling) {
      return;
    }
    this.polling = true;
    this.stopRequested = false;
    void this.pollLoop();
  }

  stopPolling(): void {
    this.stopRequested = true;
  }

  async sendMessage(chatId: string, content: string, buttons?: InlineButton[][]): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: content
    };
    if (buttons && buttons.length > 0) {
      body.reply_markup = {
        inline_keyboard: buttons.map((row) =>
          row.map((btn) => ({ text: btn.text, callback_data: btn.callbackData }))
        )
      };
    }

    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  private async handleUpdate(update: Update): Promise<void> {
    const messageText = update.message?.text ?? "";
    if (
      (messageText.startsWith("/task") ||
        messageText.startsWith("/plan") ||
        messageText.startsWith("/rerun") ||
        messageText.startsWith("/last") ||
        messageText.startsWith("/strategy") ||
        messageText.startsWith("/chat")) &&
      this.taskHandler
    ) {
      await this.taskHandler(
        String(update.message?.chat.id ?? ""),
        String(update.message?.from?.id ?? ""),
        messageText
      );
      return;
    }

    const data = update.callback_query?.data;
    if (data && this.callbackHandler) {
      await this.callbackHandler(
        String(update.callback_query?.message?.chat.id ?? ""),
        String(update.callback_query?.from.id ?? ""),
        data
      );
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopRequested) {
      try {
        const url = `https://api.telegram.org/bot${this.token}/getUpdates`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timeout: 25,
            offset: this.updateOffset,
            allowed_updates: ["message", "callback_query"]
          })
        });
        if (!response.ok) {
          throw new Error(`getUpdates failed: ${response.status}`);
        }

        const payload = (await response.json()) as {
          ok: boolean;
          result?: Array<Update & { update_id: number }>;
        };

        if (!payload.ok || !payload.result) {
          throw new Error("getUpdates returned non-ok payload");
        }

        for (const update of payload.result) {
          this.updateOffset = Math.max(this.updateOffset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch {
        await sleep(1500);
      }
    }
    this.polling = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
