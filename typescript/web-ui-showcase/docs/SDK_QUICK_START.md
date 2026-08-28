# Qoder TypeScript Agent SDK Quick Start

This guide covers the smallest patterns that can be used directly from the public exports of `@qoder-ai/qoder-agent-sdk`. It begins with a single Query and then shows a long-lived Query that continuously accepts user input. Web UI Showcase adds REST/WebSocket transport, state projection, concurrency control, and browser security boundaries on top of these contracts.

The examples target the project's currently installed `@qoder-ai/qoder-agent-sdk` 1.0.21 and Node.js 22.

## Prepare a Project

Install the SDK in a new Node.js ESM project. `zod` is a peer dependency used when defining SDK MCP Tool schemas:

```bash
npm install @qoder-ai/qoder-agent-sdk zod
```

The examples use a local `tsx` installation to run and use TypeScript plus Node types for static checking:

```bash
npm install --save-dev tsx typescript @types/node
```

Your `package.json` must contain at least:

```json
{
  "type": "module"
}
```

### Choose Authentication

- If the machine is already signed in through qodercli, use `qodercliAuth()`.
- If the server environment provides a personal access token, set `QODER_PERSONAL_ACCESS_TOKEN` and use `accessTokenFromEnv()`.

```ts
import {
  accessTokenFromEnv,
  qodercliAuth,
} from "@qoder-ai/qoder-agent-sdk";

const auth = process.env.QODER_PERSONAL_ACCESS_TOKEN
  ? accessTokenFromEnv()
  : qodercliAuth();
```

Keep the authentication object, token, SDK Query, and callbacks inside a trusted Node.js process. Do not place them in a browser bundle, REST response, localStorage, or client-side log.

## Single Query

Estimated time: 5 minutes.

Create `one-shot.ts`:

```ts
import { qodercliAuth, query } from "@qoder-ai/qoder-agent-sdk";

const prompt =
  process.argv.slice(2).join(" ") || "Describe the three main directories in this project.";

const q = query({
  prompt,
  options: {
    auth: qodercliAuth(),
    cwd: process.cwd(),
  },
});

try {
  for await (const message of q) {
    if (message.type !== "assistant") continue;

    for (const block of message.message.content) {
      if (block.type === "text" && block.text !== undefined) {
        process.stdout.write(block.text);
      }
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await q.close();
}
```

Run it:

```bash
npx tsx one-shot.ts "Read only the current directory and summarize the purpose of package.json."
```

This example has five essential boundaries:

1. `query()` is the Query creation entry point.
2. The server decides `auth` and `cwd`; `cwd` is the project root in which the Agent may work.
3. A `Query` is an `AsyncIterable<SDKMessage>` and must be consumed with `for await`.
4. Do not treat every SDK message as final Assistant text. This example explicitly filters for `assistant` messages and `text` blocks.
5. Call `await q.close()` in `finally`, whether execution completes normally or exits with an error.

For token authentication, replace only the import and `auth`:

```ts
import {
  accessTokenFromEnv,
  query,
} from "@qoder-ai/qoder-agent-sdk";

const q = query({
  prompt: "Inspect the current project.",
  options: {
    auth: accessTokenFromEnv(),
    cwd: process.cwd(),
  },
});
```

`accessTokenFromEnv()` reads the server environment. Do not pass the token through a prompt, browser field, or log message.

## Long-Lived Interactive Query

Estimated time: 15 minutes.

A chat application, WebSocket service, or queue consumer should not turn every user message into a new Query. Create an `AsyncIterable<SDKUserMessage>` that continuously feeds messages into one Query while a separate asynchronous task continuously consumes SDK output.

The following `interactive.ts` is a complete terminal example. Its queue supports a single SDK consumer, which is enough to demonstrate the core contract a Web service must implement:

```ts
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import {
  qodercliAuth,
  query,
  type SDKUserMessage,
} from "@qoder-ai/qoder-agent-sdk";

type Priority = NonNullable<SDKUserMessage["priority"]>;

class InputQueue implements AsyncIterable<SDKUserMessage> {
  readonly #items: SDKUserMessage[] = [];
  #wake: (() => void) | undefined;
  #closed = false;

  push(message: SDKUserMessage): void {
    if (this.#closed) throw new Error("InputQueue is closed.");
    this.#items.push(message);
    this.#notify();
  }

  cancel(uuid: string): boolean {
    const index = this.#items.findIndex((message) => message.uuid === uuid);
    if (index === -1) return false;
    this.#items.splice(index, 1);
    return true;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#notify();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const message = this.#items.shift();
      if (message !== undefined) {
        yield message;
        continue;
      }
      if (this.#closed) return;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
  }

  #notify(): void {
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
  }
}

function userMessage(
  text: string,
  options: { priority?: Priority; shouldQuery?: boolean } = {},
): SDKUserMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text }],
    },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    priority: options.priority ?? "next",
    shouldQuery: options.shouldQuery ?? true,
  };
}

function parseInput(line: string): {
  text: string;
  priority: Priority;
  shouldQuery: boolean;
} {
  if (line.startsWith("/now ")) {
    return { text: line.slice(5), priority: "now", shouldQuery: true };
  }
  if (line.startsWith("/later ")) {
    return { text: line.slice(7), priority: "later", shouldQuery: true };
  }
  if (line.startsWith("/note ")) {
    return { text: line.slice(6), priority: "next", shouldQuery: false };
  }
  return { text: line, priority: "next", shouldQuery: true };
}

const input = new InputQueue();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
const q = query({
  prompt: input,
  options: {
    auth: qodercliAuth(),
    cwd: process.cwd(),
  },
});

let lastUuid: string | undefined;
let outputError: unknown;
const outputTask = (async () => {
  try {
    for await (const message of q) {
      if (
        message.type === "system" &&
        message.subtype === "session_state_changed"
      ) {
        console.error(`\n[Session: ${message.state}]`);
      }
      if (message.type !== "assistant") continue;
      for (const block of message.message.content) {
        if (block.type === "text" && block.text !== undefined) {
          process.stdout.write(block.text);
        }
      }
    }
  } catch (error) {
    outputError = error;
    terminal.close();
  }
})();

try {
  console.log("Enter a message; /now, /later, and /note change the next message's semantics.");
  console.log("/interrupt stops the current turn, /cancel cancels the previous message, and /exit quits.\n");

  for await (const rawLine of terminal) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line === "/exit") break;

    if (line === "/interrupt") {
      console.dir(await q.interrupt(), { depth: null });
      continue;
    }

    if (line === "/cancel") {
      if (lastUuid === undefined) {
        console.error("There is no message to cancel.");
        continue;
      }
      const cancelledLocally = input.cancel(lastUuid);
      const cancelled =
        cancelledLocally || (await q.cancelAsyncMessage(lastUuid));
      console.error(cancelled ? "Message cancelled." : "The message can no longer be cancelled.");
      if (cancelled) lastUuid = undefined;
      continue;
    }

    const parsed = parseInput(line);
    if (parsed.text.trim().length === 0) continue;
    const message = userMessage(parsed.text, parsed);
    lastUuid = message.uuid;
    input.push(message);
  }
} finally {
  terminal.close();
  input.close();
  await q.close();
  await outputTask;
}

if (outputError !== undefined) throw outputError;
```

Run it:

```bash
npx tsx interactive.ts
```

Try these inputs:

```text
Summarize the current project. Read files only.
/later After the current response finishes, reply with LATER_OK only.
/now Stop the current response immediately and reply with NOW_OK only.
/note This note is added to the conversation without starting a model turn by itself.
/cancel
/interrupt
/exit
```

### `priority` and `shouldQuery`

| Field | Meaning |
| --- | --- |
| `priority: "now"` | Interrupt the active response and process this input as soon as possible |
| `priority: "next"` | Default; process at the next appropriate safe point |
| `priority: "later"` | Wait for the current response to finish and the session to become ready |
| `shouldQuery: false` | Add the message to the conversation without letting that message start a model turn by itself; delivery timing still follows `priority` |

Every asynchronous message that must be tracked or cancelled should use a `uuid` that is unique within the session. The example first tries to cancel the message in the application's local queue. If the `AsyncIterable` has already yielded the message to the SDK, it calls `cancelAsyncMessage(uuid)` instead.

### Do Not Invent a One-Input-to-One-Result Relationship

- Yielding a message from the application queue to the SDK proves only that the input reached the SDK transport; it does not prove that a turn completed.
- The SDK may combine multiple asynchronous inputs, and result messages do not carry a unique source-input UUID.
- `cancelAsyncMessage(uuid)` returning `true` means the queued message was cancelled. Returning `false` means it can no longer be cancelled; it does not mean the session failed.
- `interrupt()` interrupts current work without closing the Query. Coordinate the application queue using `still_queued` and the optional `cancelled` UUIDs in the receipt.
- If the runtime provides `session_state_changed`, `idle`, `running`, and `requires_action` are the primary session-lifecycle evidence. Do not clear all inputs or force the session to idle based only on an arbitrary result.

The Showcase implementation is in [`input-queue.ts`](../src/server/sdk/input-queue.ts) and [`session-controller.ts`](../src/server/sdk/session-controller.ts). The product Composer defaults to `next` / `true`, while the application port preserves both fields in full.

## Create, Resume, and Fork Sessions

Choose exactly one intent when creating a Query:

```ts
const created = query({
  prompt: input,
  options: {
    auth,
    cwd,
    sessionId: crypto.randomUUID(),
  },
});

const resumed = query({
  prompt: input,
  options: {
    auth,
    cwd,
    resume: existingSessionId,
  },
});

const forked = query({
  prompt: input,
  options: {
    auth,
    cwd,
    resume: existingSessionId,
    forkSession: true,
  },
});
```

- `sessionId` lets the host assign an identifier to a new session.
- `resume` restores an existing session. The host should ensure that `cwd` matches the session's Workspace.
- `forkSession: true` is used with `resume` to create a new branch from existing history; it must not overwrite the original session.
- Every Query has an independent lifecycle. When the host no longer retains a Query—for example, when closing, restarting, or deleting a session, or when switching targets under a single-active-session policy—stop accepting new commands before calling `await q.close()`. Do not continue reusing an old Query after a fatal transport or output failure.

## Callbacks and the Browser Boundary

A complete Web product usually also needs:

- `canUseTool`: map the SDK permission Promise to a product Approval and respond to the SDK abort signal.
- `onElicitation`: map an MCP form/URL request to a structured product interaction.
- `hooks`: provide observation, policy, or context injection without sending Hook payloads directly to the browser.
- `mcpServers`: keep remote headers, subprocess environments, and OAuth tokens on the server. An authorization URL may be displayed according to product policy, while a user-submitted callback URL should be used for one server-side control request only and must not be written to persistent client state or diagnostic events.
- `includePartialMessages`: project incremental output into stable semantic items instead of appending every delta as a new message.

These options are composed at the Showcase's single Query creation point, [`query-factory.ts`](../src/server/sdk/query-factory.ts). That fragment depends on the application's own `InputQueue`, `InteractionBroker`, configuration, and MCP/Hook registrations, so it is not a standalone Quick Start example.

## SDK Contracts and Additional Showcase Work

| Area | Public SDK contract | Showcase responsibility |
| --- | --- | --- |
| Query lifecycle | `query()`, asynchronous message iteration, `close()` | Registry, automatic availability, failure reconstruction, graceful shutdown |
| Input | `AsyncIterable<SDKUserMessage>`, priority, `shouldQuery`, cancel/interrupt | Local queue state, command correlation, conservative batch coordination, UI feedback |
| Session | `sessionId`, `resume`, `forkSession`, and catalog APIs | Workspace binding, concurrent-request deduplication, snapshot/history consistency |
| Browser | SDK-returned messages and callbacks | Zod wire model, semantic projection, redaction, size budgets, REST/WebSocket recovery |
| Checkpoint | `rewindFiles()`, `rewind()` | Dry-run UI, revision binding, single-use previews, mutation fence, authoritative history replacement |

Next, read [SDK Code Tour](SDK_CODE_TOUR.md#how-a-message-moves-through-the-system) to follow one browser message through `query()`, the SDK message stream, and the client reducer. Use the [Product Trial Guide](PRODUCT_TRIAL_GUIDE.md) to verify product behavior.
