import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AgentProvider } from "../config.js";
import { resolveRepoSnapshotPath } from "../utils/repoSnapshot.js";
import { ChatMemoryRepository } from "../repositories/chatMemoryRepository.js";
import { AuditLogger } from "./auditLogger.js";

const execFileAsync = promisify(execFile);

export class ChatService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(
    private readonly provider: AgentProvider,
    private readonly cliBin: string,
    private readonly cliTemplate: string,
    private readonly repoRoot: string,
    private readonly memory: ChatMemoryRepository,
    private readonly historyTurns: number,
    private readonly maxPromptChars: number,
    private readonly timeoutMs: number,
    private readonly audit: AuditLogger
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
    if (prompt.length > this.maxPromptChars) {
      throw new Error(`Prompt too long. Limit is ${this.maxPromptChars} characters.`);
    }
    const key = `${chatId}:${userId}`;
    if (this.activeRequests.has(key)) {
      throw new Error("Another chat request is already running. Use /chat cancel or wait.");
    }

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

    const controller = new AbortController();
    this.activeRequests.set(key, controller);
    this.audit.append({
      timestamp: new Date().toISOString(),
      taskId: `chat:${chatId}`,
      triggerUser: userId,
      eventType: "CHAT_REQUEST",
      message: `repo=${repo} prompt=${prompt.slice(0, 200)}`
    });

    try {
      const { stdout } = await this.execChatCommand(finalPrompt, repoPath, outFile, controller);

      const lastMessage = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "";
      const output = lastMessage || stdout.trim();
      if (!output) {
        return "No response from chat model.";
      }
      const clipped = output.slice(0, 3500);
      this.memory.append(chatId, userId, repo, "user", prompt);
      this.memory.append(chatId, userId, repo, "assistant", clipped);
      this.audit.append({
        timestamp: new Date().toISOString(),
        taskId: `chat:${chatId}`,
        triggerUser: userId,
        eventType: "CHAT_RESPONSE",
        message: clipped.slice(0, 200)
      });
      return clipped;
    } catch (err) {
      const e = err as {
        stderr?: string;
        stdout?: string;
        message?: string;
        killed?: boolean;
        signal?: string;
      };
      const detail = controller.signal.aborted
        ? "chat canceled by user"
        : (e.stderr || e.stdout || e.message || "chat command failed").trim();
      this.audit.append({
        timestamp: new Date().toISOString(),
        taskId: `chat:${chatId}`,
        triggerUser: userId,
        eventType: "CHAT_FAILED",
        message: detail.slice(0, 200)
      });
      throw new Error(detail);
    } finally {
      this.activeRequests.delete(key);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async execChatCommand(
    finalPrompt: string,
    repoPath: string,
    outFile: string,
    controller: AbortController
  ): Promise<{ stdout: string }> {
    if (this.cliTemplate.trim() !== "") {
      const command = this.renderTemplate(this.cliTemplate, {
        prompt: finalPrompt,
        repo_path: repoPath,
        out_file: outFile
      });
      return execFileAsync("sh", ["-lc", command], {
        cwd: process.cwd(),
        env: process.env,
        timeout: this.timeoutMs,
        signal: controller.signal
      });
    }

    if (this.provider !== "codex") {
      // Generic fallback for non-codex providers: run provider CLI with prompt as positional input.
      // This keeps default chat mode zero-config for provider switches.
      return execFileAsync(
        "sh",
        ["-lc", `${this.cliBin} ${shellEscape(finalPrompt)}`],
        {
          cwd: repoPath,
          env: process.env,
          timeout: this.timeoutMs,
          signal: controller.signal
        }
      );
    }

    return execFileAsync(
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
        env: process.env,
        timeout: this.timeoutMs,
        signal: controller.signal
      }
    );
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
      const value = vars[key];
      if (value === undefined) {
        throw new Error(`Unknown CHAT_CLI_TEMPLATE key: ${key}`);
      }
      return shellEscape(value);
    });
  }

  reset(chatId: string, userId: string): void {
    this.memory.clear(chatId, userId);
  }

  cancel(chatId: string, userId: string): boolean {
    const key = `${chatId}:${userId}`;
    const controller = this.activeRequests.get(key);
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}
