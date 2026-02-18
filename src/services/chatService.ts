import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";
import { ChatMemoryRepository } from "../repositories/chatMemoryRepository.js";

const execFileAsync = promisify(execFile);

export class ChatService {
  constructor(
    private readonly cliBin: string,
    private readonly repoRoot: string,
    private readonly memory: ChatMemoryRepository,
    private readonly historyTurns: number
  ) {}

  static deriveCliBinary(agentCliTemplate: string, explicitCliBin?: string): string {
    if (explicitCliBin && explicitCliBin.trim() !== "") {
      return explicitCliBin.trim();
    }
    const trimmed = agentCliTemplate.trim();
    if (!trimmed) {
      return "codex";
    }
    const first = trimmed.split(/\s+/)[0];
    return first || "codex";
  }

  async ask(chatId: string, userId: string, prompt: string, repo: string): Promise<string> {
    const repoPath = resolveRepoSnapshotPath(this.repoRoot, repo);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repo snapshot not found for chat: ${repoPath}`);
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "okd-chat-"));
    const outFile = path.join(tempDir, "chat-last.txt");
    const history = this.memory.listRecent(chatId, userId, this.historyTurns * 2);
    const historyBlock = history
      .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
      .join("\n");

    const systemInstruction = [
      "You are OkayDokki chat mode.",
      "Answer with concise engineering guidance based on repository context.",
      "Do not execute or propose file writes unless user explicitly asks to convert into /task."
    ].join(" ");
    const finalPrompt = [
      systemInstruction,
      "",
      `Repository: ${repo}`,
      historyBlock ? `Conversation history:\n${historyBlock}` : "",
      `User: ${prompt}`
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const { stdout } = await execFileAsync(
        this.cliBin,
        [
          "exec",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "-C",
          repoPath,
          "--output-last-message",
          outFile,
          finalPrompt
        ],
        {
          cwd: process.cwd(),
          env: process.env
        }
      );

      const lastMessage = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "";
      const output = lastMessage || stdout.trim();
      if (!output) {
        return "No response from chat model.";
      }
      const clipped = output.slice(0, 3500);
      this.memory.append(chatId, userId, repo, "user", prompt);
      this.memory.append(chatId, userId, repo, "assistant", clipped);
      return clipped;
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      const detail = (e.stderr || e.stdout || e.message || "chat command failed").trim();
      throw new Error(detail);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  reset(chatId: string, userId: string): void {
    this.memory.clear(chatId, userId);
  }
}
