import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@qoder-ai/qoder-agent-sdk";
import { InputQueue } from "../../../../src/server/sdk/input-queue.js";
import { InteractionBroker } from "../../../../src/server/sdk/interaction-broker.js";
import {
  SessionController,
} from "../../../../src/server/sdk/session-controller.js";
import type { QueryPort } from "../../../../src/server/sdk/query-port.js";
import { SessionRuntimeState } from "../../../../src/server/sdk/session-runtime-state.js";
import { createShowcaseHooks } from "../../../../src/server/sdk/hooks.js";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import type { ConversationItem } from "../../../../src/shared/model.js";

const sessionId = "00000000-0000-4000-8000-000000000601";

type ContextUsage = Awaited<ReturnType<QueryPort["getContextUsage"]>>;

function contextUsage(percentage: number): ContextUsage {
  return {
    categories: [],
    totalTokens: Math.round(percentage * 10),
    maxTokens: 1_000,
    rawMaxTokens: 1_000,
    percentage,
    gridRows: [],
    model: "fixture-model",
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (error) => reject?.(error),
  };
}

class OutputChannel implements AsyncIterable<SDKMessage> {
  readonly #values: SDKMessage[] = [];
  readonly #waiters: Array<{
    resolve: (result: IteratorResult<SDKMessage>) => void;
    reject: (error: unknown) => void;
  }> = [];
  #ended = false;

  push(message: SDKMessage): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#values.push(message);
    } else {
      waiter.resolve({ done: false, value: message });
    }
  }

  fail(error: Error): void {
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  end(): void {
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.resolve({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: async () => {
        const value = this.#values.shift();
        if (value !== undefined) {
          return { done: false, value };
        }
        if (this.#ended) {
          return { done: true, value: undefined };
        }
        return new Promise((resolve, reject) => {
          this.#waiters.push({ resolve, reject });
        });
      },
    };
  }
}

function createHarness(
  options: {
    initializationError?: Error;
    getContextUsage?: () => Promise<ContextUsage>;
    closeQuery?: (output: OutputChannel) => Promise<void>;
    now?: () => string;
    createId?: () => string;
  } = {},
) {
  const output = new OutputChannel();
  const close = vi.fn(
    async () =>
      options.closeQuery?.(output) ?? output.end(),
  );
  const interrupt = vi.fn(async () => undefined);
  const cancelAsyncMessage = vi.fn(async () => true);
  const getContextUsage = vi.fn(
    options.getContextUsage ??
      (() => Promise.resolve(contextUsage(39))),
  );
  const query = {
    [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
    initializationResult: options.initializationError
      ? vi.fn(async () => {
          throw options.initializationError;
        })
      : vi.fn(async () => ({
          capabilities: ["session_rewind_v1"],
          models: [
            {
              value: "fixture-model",
              displayName: "Fixture model",
              description: "Deterministic model.",
              isDefault: true,
            },
          ],
          skills: [{ name: "fixture-inspect" }],
          commands: [
            {
              name: "fixture-inspect",
              description: "Inspect the deterministic fixture.",
              argumentHint: "[path]",
            },
          ],
        })),
    interrupt,
    cancelAsyncMessage,
    getContextUsage,
    close,
  } as unknown as QueryPort;
  const journal = new EventJournal({
    epoch: "epoch-a",
    capacity: 100,
    now: () => "2026-08-14T08:00:00.000Z",
  });
  const interactions = new InteractionBroker({
    journal,
    now: () => "2026-08-14T08:00:00.000Z",
  });
  let nextInputId = 602;
  const input = new InputQueue({
    createUuid: () =>
      `00000000-0000-4000-8000-${String(nextInputId++).padStart(12, "0")}`,
  });
  const runtimeState = new SessionRuntimeState({ journal });
  const controller = new SessionController({
    initialModel: "fixture-model",
    initialPermissionMode: "default",
    sessionId,
    query,
    input,
    interactions,
    journal,
    runtimeState,
    now: options.now ?? (() => "2026-08-14T08:00:00.000Z"),
    createId:
      options.createId ??
      (() => `00000000-0000-4000-8000-${String(nextInputId++).padStart(12, "0")}`),
  });
  return {
    controller,
    output,
    query,
    input,
    interactions,
    runtimeState,
    journal,
    close,
    interrupt,
    cancelAsyncMessage,
    getContextUsage,
  };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

function conversationItems(journal: EventJournal): ConversationItem[] {
  const replay = journal.replay({ epoch: "epoch-a", after: 0 });
  if (replay.kind !== "events") return [];
  return replay.events.flatMap((event) =>
    event.type === "conversation.item" ? [event.payload.item] : [],
  );
}

describe("SessionController", () => {
  it("projects initialization commands and Skills into Session runtime", async () => {
    const harness = createHarness();

    await harness.controller.start();

    expect(harness.runtimeState.snapshot(sessionId)).toMatchObject({
      currentModel: "fixture-model",
      currentPermissionMode: "default",
      capabilities: ["session_rewind_v1"],
      skills: ["fixture-inspect"],
      models: [
        {
          value: "fixture-model",
          displayName: "Fixture model",
          description: "Deterministic model.",
          isDefault: true,
        },
      ],
      commands: [
        {
          name: "fixture-inspect",
          description: "Inspect the deterministic fixture.",
          argumentHint: "[path]",
        },
      ],
      composerCommands: [
        {
          name: "context",
          execution: "context-control",
        },
        {
          name: "fixture-inspect",
          description: "Inspect the deterministic fixture.",
          argumentHint: "[path]",
          execution: "sdk-input",
        },
        {
          name: "mcp",
          execution: "mcp-control",
        },
        {
          name: "model",
          execution: "model-control",
        },
        {
          name: "permissions",
          execution: "permission-control",
        },
      ],
    });
    await harness.controller.close("test complete");
  });

  it("transitions through start, run, completion, and interrupt states", async () => {
    const harness = createHarness();

    await expect(harness.controller.start()).resolves.toEqual({
      sessionId,
      capabilities: ["session_rewind_v1"],
    });
    expect(harness.controller.lifecycle()).toEqual({
      phase: "idle",
      awaitingUser: false,
    });

    harness.controller.send({
      text: "Inspect",
      priority: "next",
      shouldQuery: true,
    });
    expect(harness.controller.lifecycle().phase).toBe("running");
    harness.output.push({
      type: "result",
      subtype: "success",
      result: "Done",
      uuid: "00000000-0000-4000-8000-000000000604",
      session_id: sessionId,
    } as unknown as SDKMessage);
    await waitFor(
      () => harness.controller.lifecycle().phase === "idle",
      "controller did not return to idle",
    );

    harness.controller.send({
      text: "Run",
      priority: "next",
      shouldQuery: true,
    });
    const interrupted = harness.controller.interrupt();
    expect(harness.controller.lifecycle().phase).toBe("interrupting");
    await interrupted;
    expect(harness.interrupt).toHaveBeenCalledOnce();
    expect(harness.controller.lifecycle().phase).toBe("idle");
    await harness.controller.close("test complete");
  });

  it("loads Context after initialization without delaying Session startup", async () => {
    const context = deferred<ContextUsage>();
    const harness = createHarness({
      getContextUsage: () => context.promise,
    });

    await harness.controller.start();
    expect(harness.runtimeState.snapshot(sessionId).contextStatus).toBe(
      "loading",
    );

    context.resolve(contextUsage(39));
    await waitFor(
      () => harness.runtimeState.snapshot(sessionId).contextStatus === "ready",
      "Context did not become ready",
    );
    expect(harness.runtimeState.snapshot(sessionId).context).toMatchObject({
      percentage: 39,
      totalTokens: 390,
      maxTokens: 1_000,
    });
    await harness.controller.close("test complete");
  });

  it("keeps Session startup usable when automatic Context refresh fails", async () => {
    const harness = createHarness({
      getContextUsage: async () => {
        throw new Error("Context unavailable");
      },
    });

    await expect(harness.controller.start()).resolves.toMatchObject({
      sessionId,
    });
    await waitFor(
      () =>
        harness.runtimeState.snapshot(sessionId).contextStatus === "unsupported",
      "Context did not become unsupported",
    );
    expect(harness.controller.lifecycle().phase).toBe("idle");
    await harness.controller.close("test complete");
  });

  it("refreshes Context after every completed turn", async () => {
    const harness = createHarness();
    await harness.controller.start();
    await waitFor(
      () => harness.getContextUsage.mock.calls.length === 1,
      "startup Context refresh was not requested",
    );

    harness.controller.send({
      text: "Inspect",
      priority: "next",
      shouldQuery: true,
    });
    harness.output.push({
      type: "result",
      subtype: "success",
      result: "Done",
      uuid: "00000000-0000-4000-8000-000000000621",
      session_id: sessionId,
    } as unknown as SDKMessage);

    await waitFor(
      () => harness.getContextUsage.mock.calls.length === 2,
      "completed turn did not refresh Context",
    );
    await harness.controller.close("test complete");
  });

  it("ignores a stale Context result and preserves a ready value on failure", async () => {
    const first = deferred<ContextUsage>();
    const second = deferred<ContextUsage>();
    const getContextUsage = vi
      .fn<() => Promise<ContextUsage>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const harness = createHarness({ getContextUsage });

    await harness.controller.start();
    const newer = harness.controller.refreshContext({ required: false });
    second.resolve(contextUsage(42));
    await newer;
    first.resolve(contextUsage(7));
    await Promise.resolve();
    expect(harness.runtimeState.snapshot(sessionId)).toMatchObject({
      contextStatus: "ready",
      context: { percentage: 42 },
    });

    await expect(
      harness.controller.refreshContext({ required: true }),
    ).rejects.toThrow("refresh unavailable");
    expect(harness.runtimeState.snapshot(sessionId)).toMatchObject({
      contextStatus: "ready",
      context: { percentage: 42 },
    });
    await harness.controller.close("test complete");
  });

  it("returns to Restorable when initialization fails", async () => {
    const harness = createHarness({
      initializationError: new Error("startup secret"),
    });

    await expect(harness.controller.start()).rejects.toThrow("startup secret");
    expect(harness.controller.lifecycle()).toMatchObject({
      phase: "restorable",
      awaitingUser: false,
      failure: { code: "INTERNAL_ERROR" },
    });
  });

  it("fully releases a fatal controller without observing later Session work", async () => {
    const staleContext = deferred<ContextUsage>();
    const closeGate = deferred<void>();
    const harness = createHarness({
      getContextUsage: () => staleContext.promise,
      closeQuery: async (output) => {
        await closeGate.promise;
        output.end();
      },
    });
    await harness.controller.start();
    const release = vi.fn();
    harness.controller.attachRegistryRelease(release);
    let reentrantClose: Promise<void> | undefined;
    let closeRequested = false;
    const unsubscribe = harness.journal.subscribe((event) => {
      if (
        event.type === "session.lifecycle" &&
        event.payload.lifecycle.phase === "restorable" &&
        !closeRequested
      ) {
        closeRequested = true;
        reentrantClose = harness.controller.close("reentrant cleanup");
      }
    });

    harness.output.fail(new Error("transport secret"));

    await waitFor(
      () => harness.controller.lifecycle().phase === "restorable",
      "controller did not become restorable",
    );
    expect(harness.controller.lifecycle().failure).toEqual({
      code: "INTERNAL_ERROR",
      message: "The local server could not complete the request.",
      retryable: false,
    });
    await waitFor(
      () => harness.close.mock.calls.length === 1,
      "fatal controller did not close its Query",
    );
    expect(release).not.toHaveBeenCalled();
    closeGate.resolve(undefined);
    await harness.controller.close("wait for fatal cleanup");
    await reentrantClose;
    unsubscribe();
    expect(release).toHaveBeenCalledOnce();
    staleContext.resolve(contextUsage(88));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.runtimeState.snapshot(sessionId).context).toBeUndefined();
    expect(() =>
      harness.input.enqueue({
        text: "旧输入不应继续接收",
        priority: "next",
        shouldQuery: true,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));

    const later = harness.interactions.canUseTool(() => sessionId)(
      "Read",
      { file_path: "README.md" },
      {
        signal: new AbortController().signal,
        toolUseID: "replacement-tool",
      },
    );
    const laterOutcome = later.then(
      () => "resolved",
      () => "rejected",
    );
    expect(harness.controller.lifecycle()).toMatchObject({
      phase: "restorable",
      awaitingUser: false,
    });
    harness.interactions.abortSession(sessionId, new Error("test complete"));
    expect(await laterOutcome).toBe("rejected");

    await harness.controller.close("repeated cleanup");
    expect(harness.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("cancels buffered input before delegating delivered input to Query", async () => {
    const harness = createHarness();
    await harness.controller.start();
    const buffered = harness.controller.send({
      text: "Buffered",
      priority: "later",
      shouldQuery: false,
    });

    await expect(harness.controller.cancelMessage(buffered.uuid)).resolves.toBe(
      true,
    );
    expect(harness.cancelAsyncMessage).not.toHaveBeenCalled();

    const delivered = harness.controller.send({
      text: "Delivered",
      priority: "later",
      shouldQuery: false,
    });
    await harness.input[Symbol.asyncIterator]().next();
    await expect(
      harness.controller.cancelMessage(delivered.uuid),
    ).resolves.toBe(true);
    expect(harness.cancelAsyncMessage).toHaveBeenCalledWith(delivered.uuid);
    await harness.controller.close("test complete");
  });

  it("merges stream deltas and a differently identified final message", async () => {
    const harness = createHarness();
    await harness.controller.start();

    for (const text of ["你", "好"]) {
      harness.output.push({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-4000-8000-000000000611",
        session_id: sessionId,
      } as SDKMessage);
    }
    harness.output.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "你好，我已完成。" }],
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000612",
      session_id: sessionId,
    } as SDKMessage);

    await waitFor(
      () =>
        conversationItems(harness.journal).some(
          (item) =>
            item.kind === "assistant" && item.status === "complete",
        ),
      "assistant segment did not complete",
    );
    const assistantItems = conversationItems(harness.journal).filter(
      (item) => item.kind === "assistant",
    );
    expect(new Set(assistantItems.map((item) => item.id)).size).toBe(1);
    expect(assistantItems.at(-1)).toMatchObject({
      text: "你好，我已完成。",
      status: "complete",
    });
    await harness.controller.close("test complete");
  });

  it("keeps Assistant segments around a Tool call in timeline order", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.controller.send({
      text: "检查 README",
      priority: "next",
      shouldQuery: true,
    });

    for (const text of ["正在", "检查项目", "…"]) {
      harness.output.push({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        },
        parent_tool_use_id: null,
        uuid: "00000000-0000-4000-8000-000000000625",
        session_id: sessionId,
      } as SDKMessage);
    }
    harness.output.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-read",
          name: "Read",
          input: { file_path: "README.md" },
        }],
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000626",
      session_id: sessionId,
    } as SDKMessage);
    await waitFor(
      () => conversationItems(harness.journal).some(
        (item) => item.kind === "tool" && item.toolUseId === "tool-read",
      ),
      "Tool request was not projected",
    );
    harness.output.push({
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "tool-read",
          content: "read complete",
        }],
      },
      parent_tool_use_id: null,
      isSynthetic: true,
      uuid: "00000000-0000-4000-8000-000000000627",
      session_id: sessionId,
    } as SDKMessage);
    harness.output.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "检查完成。" }],
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000628",
      session_id: sessionId,
    } as SDKMessage);
    harness.output.push({
      type: "result",
      subtype: "success",
      result: "Done",
      uuid: "00000000-0000-4000-8000-000000000629",
      session_id: sessionId,
    } as unknown as SDKMessage);

    await waitFor(
      () => harness.controller.lifecycle().phase === "idle",
      "Tool loop turn did not complete",
    );
    const canonical = new Map<string, ConversationItem>();
    for (const item of conversationItems(harness.journal)) {
      canonical.set(item.id, item);
    }
    expect([...canonical.values()]).toMatchObject([
      {
        kind: "assistant",
        text: "正在检查项目…",
        status: "complete",
      },
      {
        kind: "tool",
        toolUseId: "tool-read",
        lifecycle: "completed",
      },
      {
        kind: "assistant",
        text: "检查完成。",
        status: "complete",
      },
    ]);
    expect(new Set(
      [...canonical.values()]
        .filter((item) => item.kind === "assistant")
        .map((item) => item.id),
    ).size).toBe(2);
    await harness.controller.close("test complete");
  });

  it("keeps one Tool item id through duplicate requests and repeated results", async () => {
    let now = "2026-08-14T08:00:00.000Z";
    let nextItemId = 630;
    const harness = createHarness({
      now: () => now,
      createId: () =>
        `00000000-0000-4000-8000-${String(nextItemId++).padStart(12, "0")}`,
    });
    await harness.controller.start();
    const request = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-write",
          name: "Write",
          input: { file_path: "notes.md", content: "draft" },
        }],
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000631",
      session_id: sessionId,
    } as SDKMessage;

    harness.output.push(request);
    await waitFor(
      () => conversationItems(harness.journal).some(
        (item) => item.kind === "tool" && item.toolUseId === "tool-write",
      ),
      "Tool request was not projected",
    );
    harness.output.push(request);
    await waitFor(
      () => conversationItems(harness.journal).filter(
        (item) => item.kind === "tool" && item.toolUseId === "tool-write",
      ).length >= 2,
      "duplicate Tool request was not observed",
    );

    for (const [offset, result] of [[120, "saved"], [240, "saved again"]] as const) {
      now = `2026-08-14T08:00:00.${String(offset).padStart(3, "0")}Z`;
      harness.output.push({
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool-write",
            content: result,
          }],
        },
        parent_tool_use_id: null,
        isSynthetic: true,
        uuid: crypto.randomUUID(),
        session_id: sessionId,
      } as SDKMessage);
      await waitFor(
        () => conversationItems(harness.journal).some(
          (item) => item.kind === "tool" && item.result === result,
        ),
        `Tool result ${result} was not projected`,
      );
    }

    const tools = conversationItems(harness.journal).filter(
      (item) => item.kind === "tool" && item.toolUseId === "tool-write",
    );
    expect(new Set(tools.map((item) => item.id)).size).toBe(1);
    expect(tools.at(-1)).toMatchObject({
      lifecycle: "completed",
      result: "saved again",
      startedAt: "2026-08-14T08:00:00.000Z",
      completedAt: "2026-08-14T08:00:00.240Z",
      durationMs: 240,
    });
    await harness.controller.close("test complete");
  });

  it("keeps generic PreToolUse running updates canonical and idempotent", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.output.push({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-write",
          name: "Write",
          input: { file_path: "notes.md", content: "draft" },
        }],
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000641",
      session_id: sessionId,
    } as SDKMessage);
    await waitFor(
      () => conversationItems(harness.journal).some(
        (item) => item.kind === "tool" && item.toolUseId === "tool-write",
      ),
      "Tool request was not projected",
    );
    const hooks = createShowcaseHooks({
      sessionId: () => sessionId,
      runtimeState: harness.runtimeState,
      onToolRunning: (toolUseId) =>
        harness.controller.markToolRunning(toolUseId),
    });
    const preToolUse = hooks.PreToolUse?.[0]?.hooks[0];
    const signal = new AbortController().signal;
    for (const toolUseId of ["missing-tool", "tool-write", "tool-write"]) {
      await preToolUse?.(
        {
          session_id: sessionId,
          transcript_path: "/repo/transcript.jsonl",
          cwd: "/repo",
          hook_event_name: "PreToolUse",
          tool_name: "Write",
          tool_input: { file_path: "notes.md", content: "draft" },
          tool_use_id: toolUseId,
        },
        toolUseId,
        { signal },
      );
    }
    harness.output.push({
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "tool-write",
          content: "write complete",
        }],
      },
      parent_tool_use_id: null,
      isSynthetic: true,
      uuid: "00000000-0000-4000-8000-000000000643",
      session_id: sessionId,
    } as SDKMessage);

    await waitFor(
      () => conversationItems(harness.journal).some(
        (item) =>
          item.kind === "tool" &&
          item.toolUseId === "tool-write" &&
          item.lifecycle === "completed",
      ),
      "Tool result was not projected",
    );
    const tools = conversationItems(harness.journal).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolUseId === "tool-write",
    );
    expect(tools.map((item) => item.lifecycle)).toEqual([
      "requested",
      "running",
      "completed",
    ]);
    expect(new Set(tools.map((item) => item.id)).size).toBe(1);
    expect(conversationItems(harness.journal).some(
      (item) => item.kind === "tool" && item.toolUseId === "missing-tool",
    )).toBe(false);
    await preToolUse?.(
      {
        session_id: sessionId,
        transcript_path: "/repo/transcript.jsonl",
        cwd: "/repo",
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: "notes.md", content: "draft" },
        tool_use_id: "tool-write",
      },
      "tool-write",
      { signal },
    );
    expect(conversationItems(harness.journal).filter(
      (item) => item.kind === "tool" && item.toolUseId === "tool-write",
    )).toHaveLength(3);
    await harness.controller.close("test complete");
  });

  it("keeps partial assistant text when the SDK stream fails", async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.output.push({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "已生成" },
      },
      parent_tool_use_id: null,
      uuid: "00000000-0000-4000-8000-000000000613",
      session_id: sessionId,
    } as SDKMessage);
    await waitFor(
      () => conversationItems(harness.journal).some(
        (item) => item.kind === "assistant" && item.status === "streaming",
      ),
      "assistant segment did not start",
    );

    harness.output.fail(new Error("transport secret"));

    await waitFor(
      () => harness.controller.lifecycle().phase === "restorable",
      "controller did not become restorable",
    );
    expect(conversationItems(harness.journal).at(-1)).toMatchObject({
      kind: "assistant",
      text: "已生成",
      status: "interrupted",
    });
  });

  it("closes once, aborts interactions, waits for the pump, and releases last", async () => {
    const harness = createHarness();
    await harness.controller.start();
    const release = vi.fn();
    harness.controller.attachRegistryRelease(release);
    const abortSession = vi.spyOn(harness.interactions, "abortSession");

    await Promise.all([
      harness.controller.close("server shutdown"),
      harness.controller.close("server shutdown"),
    ]);

    expect(harness.close).toHaveBeenCalledOnce();
    expect(abortSession).toHaveBeenCalledWith(sessionId, expect.any(Error));
    expect(release).toHaveBeenCalledOnce();
    expect(harness.controller.lifecycle().phase).toBe("restorable");
    expect(() =>
      harness.controller.send({
        text: "Closed",
        priority: "next",
        shouldQuery: true,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
  });
});
