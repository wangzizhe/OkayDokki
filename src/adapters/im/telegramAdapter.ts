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

  constructor(private readonly token: string, private readonly secret: string) {}

  onTaskCommand(handler: TaskHandler): void {
    this.taskHandler = handler;
  }

  onCallback(handler: CallbackHandler): void {
    this.callbackHandler = handler;
  }

  mountWebhook(path: string): express.RequestHandler {
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
    if (messageText.startsWith("/task") && this.taskHandler) {
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
}

