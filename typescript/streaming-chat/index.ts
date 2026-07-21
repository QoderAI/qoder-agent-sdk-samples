import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as readline from "node:readline/promises";

import {
  accessTokenFromEnv,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiter?: (message: SDKUserMessage | null) => void;
  private ended = false;

  push(text: string): void {
    if (this.ended) throw new Error("The input stream is already closed.");
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

function parseArguments(): { workspace: string; prompts: string[] } {
  const args = process.argv.slice(2);
  const workspaceIndex = args.indexOf("--workspace");
  let workspace = process.cwd();
  if (workspaceIndex !== -1) {
    const value = args[workspaceIndex + 1];
    if (!value) throw new Error("--workspace requires a path.");
    workspace = value;
    args.splice(workspaceIndex, 2);
  }
  return { workspace: resolve(workspace), prompts: args };
}

function printStreamEvent(message: SDKMessage): boolean {
  if (message.type !== "stream_event") return false;
  const event = message.event as {
    delta?: { type?: string; text?: string; thinking?: string };
  };
  if (event.delta?.type === "text_delta" && event.delta.text) {
    process.stdout.write(event.delta.text);
    return true;
  }
  return false;
}

export async function run(
  workspace: string,
  scriptedPrompts: string[],
): Promise<void> {
  const interactive = scriptedPrompts.length === 0;
  const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const input = new MessageQueue();
  const stream = query({
    prompt: input,
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
      includePartialMessages: true,
      maxTurns: 6,
    },
  });

  let streamedText = false;
  let successfulTurns = 0;
  let submittedTurns = 0;
  let resolveTurn: (() => void) | undefined;
  let rejectTurn: ((error: Error) => void) | undefined;

  const waitForTurn = (): Promise<void> =>
    new Promise((resolveDone, rejectDone) => {
      resolveTurn = resolveDone;
      rejectTurn = rejectDone;
    });

  const outputDone = (async () => {
    for await (const message of stream) {
      streamedText = printStreamEvent(message) || streamedText;

      if (message.type === "assistant" && !streamedText) {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") process.stdout.write(block.text);
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype !== "success") {
          const error = new Error(message.errors?.join("\n") || message.subtype);
          rejectTurn?.(error);
          rejectTurn = undefined;
          throw error;
        }
        successfulTurns += 1;
        process.stdout.write("\n");
        streamedText = false;
        resolveTurn?.();
        resolveTurn = undefined;
      }
    }
  })();

  try {
    if (interactive) {
      while (true) {
        const prompt = (await terminal.question("you> ")).trim();
        if (!prompt || prompt === "/exit") break;
        const turnDone = waitForTurn();
        input.push(prompt);
        submittedTurns += 1;
        await turnDone;
      }
    } else {
      for (const prompt of scriptedPrompts) {
        const turnDone = waitForTurn();
        input.push(prompt);
        submittedTurns += 1;
        await turnDone;
      }
    }
  } finally {
    input.end();
    terminal.close();
    await stream.close();
    await outputDone;
  }

  if (successfulTurns !== submittedTurns) {
    throw new Error(
      `Expected ${submittedTurns} successful turns, received ${successfulTurns}.`,
    );
  }
}

async function main(): Promise<void> {
  const { workspace, prompts } = parseArguments();
  await run(workspace, prompts);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
