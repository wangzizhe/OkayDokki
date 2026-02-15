export interface InlineButton {
  text: string;
  callbackData: string;
}

export interface IMAdapter {
  sendMessage(chatId: string, content: string, buttons?: InlineButton[][]): Promise<void>;
  onTaskCommand(handler: (chatId: string, userId: string, text: string) => Promise<void>): void;
  onCallback(handler: (chatId: string, userId: string, data: string) => Promise<void>): void;
  mountWebhook(path: string): import("express").RequestHandler;
}

