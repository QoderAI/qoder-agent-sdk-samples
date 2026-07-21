import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as readline from "node:readline/promises";

import {
  accessTokenFromEnv,
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiter?: (message: SDKUserMessage | null) => void;
  private ended = false;

  push(text: string): void {
    if (this.ended) throw new Error("The query input is closed.");
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
    };
    if (this.waiter) {
      const resolveNext = this.waiter;
      this.waiter = undefined;
      resolveNext(message);
    } else {
      this.buffered.push(message);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiter) {
      const resolveNext = this.waiter;
      this.waiter = undefined;
      resolveNext(null);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const buffered = this.buffered.shift();
      if (buffered) {
        yield buffered;
        continue;
      }
      if (this.ended) return;
      const next = await new Promise<SDKUserMessage | null>((resolveNext) => {
        this.waiter = resolveNext;
      });
      if (!next) return;
      yield next;
    }
  }
}

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

function streamText(message: SDKMessage): string | undefined {
  if (message.type !== "stream_event") return undefined;
  const event = message.event as {
    delta?: { type?: string; text?: string };
  };
  return event.delta?.type === "text_delta" ? event.delta.text : undefined;
}

class ConversationApp {
  private activeQuery?: Query;
  private input?: MessageQueue;
  private outputTask?: Promise<void>;
  private sessionId?: string;
  private turnActive = false;
  private streamedText = false;
  private explicitClose = false;
  private interruptRequested = false;
  private resolveTurn?: () => void;
  private rejectTurn?: (error: Error) => void;

  constructor(private readonly workspace: string) {}

  async open(resume: boolean): Promise<void> {
    if (this.activeQuery) {
      console.log("[app] A query is already open. Use /close first.");
      return;
    }
    if (resume && !this.sessionId) {
      console.log("[app] No previous session is available to resume.");
      return;
    }

    const input = new MessageQueue();
    console.log(
      `[lifecycle] opening query (${resume ? `resume ${this.sessionId}` : "new session"})`,
    );
    const activeQuery = query({
      prompt: input,
      options: {
        auth: accessTokenFromEnv(),
        cwd: this.workspace,
        model: "auto",
        tools: ["Read", "Glob", "Grep"],
        allowedTools: ["Read", "Glob", "Grep"],
        includePartialMessages: true,
        maxTurns: 8,
        ...(resume ? { resume: this.sessionId } : {}),
      },
    });

    this.input = input;
    this.activeQuery = activeQuery;
    this.explicitClose = false;
    this.outputTask = this.consume(activeQuery);
  }

  async send(prompt: string): Promise<void> {
    if (!this.activeQuery || !this.input) {
      console.log("[app] The query is closed. Use /resume to continue.");
      return;
    }
    if (this.turnActive) {
      console.log("[app] A response is active. Wait or press Ctrl+C.");
      return;
    }
    this.turnActive = true;
    this.streamedText = false;
    this.interruptRequested = false;
    const turnDone = new Promise<void>((resolveTurn, rejectTurn) => {
      this.resolveTurn = resolveTurn;
      this.rejectTurn = rejectTurn;
    });
    console.log("[state] generating; press Ctrl+C to interrupt this turn");
    this.input.push(prompt);
    await turnDone;
  }

  async interrupt(): Promise<void> {
    if (!this.activeQuery || !this.turnActive || this.interruptRequested) return;
    this.interruptRequested = true;
    console.log("[lifecycle] interrupt requested");
    await this.activeQuery.interrupt();
    console.log("\n[lifecycle] runtime acknowledged the interrupt");
  }

  isGenerating(): boolean {
    return this.turnActive;
  }

  async close(): Promise<void> {
    const activeQuery = this.activeQuery;
    if (!activeQuery) {
      console.log("[app] The query is already closed.");
      return;
    }

    console.log("[lifecycle] closing query");
    this.explicitClose = true;
    this.input?.end();
    await activeQuery.close();
    await this.outputTask;
    this.activeQuery = undefined;
    this.input = undefined;
    this.outputTask = undefined;
    this.turnActive = false;
    console.log(
      `[lifecycle] query closed; session ${this.sessionId ?? "not created"} can be resumed`,
    );
  }

  status(): void {
    const queryState = this.activeQuery ? "open" : "closed";
    const turnState = this.turnActive ? "generating" : "idle";
    console.log(
      `[status] query=${queryState} turn=${turnState} session=${this.sessionId ?? "pending"}`,
    );
  }

  private async consume(activeQuery: Query): Promise<void> {
    try {
      for await (const message of activeQuery) {
        if (message.type === "system" && message.subtype === "init") {
          this.sessionId = message.session_id;
          console.log(`[lifecycle] query ready; session=${message.session_id}`);
          continue;
        }

        const partial = streamText(message);
        if (partial) {
          process.stdout.write(partial);
          this.streamedText = true;
          continue;
        }

        if (!this.streamedText) {
          for (const text of assistantText(message)) process.stdout.write(text);
        }

        if (message.type === "result") {
          this.sessionId = message.session_id;
          this.turnActive = false;
          if (message.subtype === "success") {
            console.log("\n[state] turn completed; query remains open");
            this.resolveTurn?.();
          } else if (this.interruptRequested) {
            console.log("\n[state] turn interrupted; query remains open");
            this.resolveTurn?.();
          } else {
            const error = new Error(
              message.errors?.join("; ") || message.subtype,
            );
            console.log(`\n[state] turn failed: ${error.message}`);
            this.rejectTurn?.(error);
          }
          this.resolveTurn = undefined;
          this.rejectTurn = undefined;
        }
      }
    } catch (error) {
      const queryError =
        error instanceof Error ? error : new Error(String(error));
      console.error(`\n[app] query error: ${queryError.message}`);
      this.rejectTurn?.(queryError);
      this.resolveTurn = undefined;
      this.rejectTurn = undefined;
    } finally {
      this.turnActive = false;
      if (!this.explicitClose && this.activeQuery === activeQuery) {
        this.activeQuery = undefined;
        this.input = undefined;
        console.log("[lifecycle] query ended by the runtime");
      }
    }
  }
}

function printHelp(): void {
  console.log(`
Commands:
  /status     show query, turn, and session state
  /close      close the query and preserve its resumable session
  /resume     open a new query that resumes the preserved session
  /exit       close the query and exit
  /help       show this help

Any other input sends a new conversation turn. Press Ctrl+C while the agent is
generating to interrupt only that turn and keep the query open.
`);
}

export async function run(workspace: string): Promise<void> {
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const app = new ConversationApp(workspace);
  terminal.on("SIGINT", () => {
    if (app.isGenerating()) {
      void app.interrupt().catch(console.error);
      return;
    }
    console.log("\n[app] No response is active. Use /exit to close cleanly.");
  });
  await app.open(false);
  printHelp();

  try {
    while (true) {
      const input = (await terminal.question("you> ")).trim();
      if (!input) continue;
      if (input === "/exit") break;
      if (input === "/help") printHelp();
      else if (input === "/status") app.status();
      else if (input === "/close") await app.close();
      else if (input === "/resume") await app.open(true);
      else await app.send(input);
    }
  } finally {
    terminal.close();
    await app.close();
  }
}

async function main(): Promise<void> {
  const workspace = resolve(process.argv[2] ?? process.cwd());
  await run(workspace);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
