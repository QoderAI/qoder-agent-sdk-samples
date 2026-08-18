import { randomUUID } from "node:crypto";
import type { WireError } from "../../shared/errors.js";
import type { ConversationItem, QueuedInputView } from "../../shared/model.js";
import type { SelectablePermissionMode } from "../../shared/permissions.js";
import { AppError, toWireError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import type {
  EnqueueInput,
  InputQueue,
  QueuedInput,
} from "./input-queue.js";
import type { InteractionBroker } from "./interaction-broker.js";
import { SessionRuntimeState } from "./session-runtime-state.js";
import type { McpService } from "./mcp-service.js";
import {
  projectSdkMessage,
  type ProjectionAction,
} from "./message-projector.js";
import type { QueryPort } from "./query-port.js";
import {
  projectBrowserRecord,
  projectBrowserRecords,
} from "./browser-projection.js";
import { buildComposerCommandCatalog } from "./composer-command-catalog.js";

export type SessionLifecycle = {
  phase: "restorable" | "starting" | "idle" | "running" | "interrupting";
  awaitingUser: boolean;
  failure?: WireError;
};

type AssistantSegment =
  | { state: "streaming"; text: string }
  | { state: "sealed"; text: string }
  | { state: "final"; sourceId: string; text: string };

type TerminalCleanupOptions = {
  reason: string;
  fromPump: boolean;
  failure?: WireError;
  cause?: unknown;
};

export class SessionController {
  readonly #sessionId: string;
  readonly #query: QueryPort;
  readonly #input: InputQueue;
  readonly #interactions: InteractionBroker;
  readonly #journal: EventJournal;
  readonly #mcp: McpService | undefined;
  readonly #now: () => string;
  readonly #createId: () => string;
  readonly #initialModel: string | null;
  readonly #initialPermissionMode: SelectablePermissionMode;
  readonly #includeRawEvents: boolean;
  readonly #messages = new Map<string, ConversationItem>();
  readonly #runtimeState: SessionRuntimeState;
  #lifecycle: SessionLifecycle = {
    phase: "restorable",
    awaitingUser: false,
  };
  #capabilities: string[] = [];
  #pumpPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;
  #closing = false;
  #registryRelease: (() => void) | undefined;
  #registryReleaseAttached = false;
  #unsubscribeInput: (() => void) | undefined;
  #unsubscribeInteractions: (() => void) | undefined;
  #activeAssistantItemId: string | undefined;
  #activeAssistantSegments: AssistantSegment[] = [];
  #contextRequestSequence = 0;

  constructor(options: {
    sessionId: string;
    query: QueryPort;
    input: InputQueue;
    interactions: InteractionBroker;
    journal: EventJournal;
    mcp?: McpService;
    runtimeState?: SessionRuntimeState;
    now?: () => string;
    createId?: () => string;
    initialModel: string | null;
    initialPermissionMode: SelectablePermissionMode;
    includeRawEvents?: boolean;
  }) {
    this.#sessionId = options.sessionId;
    this.#query = options.query;
    this.#input = options.input;
    this.#interactions = options.interactions;
    this.#journal = options.journal;
    this.#mcp = options.mcp;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId = options.createId ?? randomUUID;
    this.#initialModel = options.initialModel;
    this.#initialPermissionMode = options.initialPermissionMode;
    this.#includeRawEvents = options.includeRawEvents ?? true;
    this.#runtimeState =
      options.runtimeState ?? new SessionRuntimeState({ journal: options.journal });
  }

  async start(): Promise<{ sessionId: string; capabilities: string[] }> {
    if (this.#lifecycle.phase !== "restorable" || this.#closing) {
      throw new AppError({
        code: "SESSION_LIFECYCLE_CONFLICT",
        message: "This Session cannot be started in its current state.",
        status: 409,
        retryable: false,
      });
    }
    this.#setLifecycle({ phase: "starting", awaitingUser: false });
    try {
      const initialization = await this.#query.initializationResult();
      this.#capabilities = [...(initialization.capabilities ?? [])];
      await this.#mcp?.preflight(this.#sessionId, this.#query);
      this.#runtimeState.merge(this.#sessionId, {
        currentModel: this.#initialModel,
        currentPermissionMode: this.#initialPermissionMode,
        capabilities: [...this.#capabilities],
        models: projectBrowserRecords(initialization.models ?? []),
        skills: (initialization.skills ?? []).map((skill) => skill.name),
        commands: (initialization.commands ?? []).map((command) => ({
          name: command.name,
          description: command.description ?? "",
          argumentHint: command.argumentHint ?? "",
        })),
        composerCommands: buildComposerCommandCatalog(initialization),
      });
      this.#unsubscribeInput = this.#input.subscribe((change) => {
        if ("removed" in change) {
          this.#journal.publish(
            {
              type: "input.removed",
              payload: {
                sessionId: this.#sessionId,
                messageUuid: change.uuid,
              },
            },
            { sessionId: this.#sessionId },
          );
          return;
        }
        const view: QueuedInputView = {
          sessionId: this.#sessionId,
          uuid: change.uuid,
          priority: change.priority,
          shouldQuery: change.shouldQuery,
          textPreview: change.text.slice(0, 160),
          state: change.state,
        };
        this.#journal.publish(
          { type: "input.upserted", payload: view },
          { sessionId: this.#sessionId },
        );
      });
      this.#unsubscribeInteractions = this.#interactions.subscribe(
        this.#sessionId,
        (pendingCount) => {
          this.#setLifecycle({
            ...this.#lifecycle,
            awaitingUser: pendingCount > 0,
          });
        },
      );
      this.#pumpPromise = this.#pump();
      this.#setLifecycle({ phase: "idle", awaitingUser: false });
      void this.refreshContext({ required: false });
      return {
        sessionId: this.#sessionId,
        capabilities: [...this.#capabilities],
      };
    } catch (error) {
      this.#setLifecycle({
        phase: "restorable",
        awaitingUser: false,
        failure: toWireError(error),
      });
      throw error;
    }
  }

  attachRegistryRelease(release: () => void): void {
    if (this.#registryReleaseAttached) {
      throw new AppError({
        code: "SESSION_REGISTRY_ALREADY_ATTACHED",
        message: "This Session already owns a registry reservation.",
        status: 500,
        retryable: false,
      });
    }
    this.#registryReleaseAttached = true;
    this.#registryRelease = release;
  }

  send(input: EnqueueInput): QueuedInput {
    if (
      this.#closing ||
      (this.#lifecycle.phase !== "idle" &&
        this.#lifecycle.phase !== "running")
    ) {
      throw new AppError({
        code: "SESSION_CLOSED",
        message: "此 Session 当前不可用。请重新选择该 Session 后重试发送。",
        status: 409,
        retryable: true,
      });
    }
    this.#mcp?.requireReady(this.#sessionId);
    const queued = this.#input.enqueue(input);
    if (input.shouldQuery && this.#lifecycle.phase === "idle") {
      this.#setLifecycle({
        phase: "running",
        awaitingUser: this.#lifecycle.awaitingUser,
      });
    }
    return queued;
  }

  markToolRunning(toolUseId: string): void {
    this.#reduce({
      type: "conversation.update-tool",
      toolUseId,
      patch: { lifecycle: "running" },
    });
  }

  async cancelMessage(uuid: string): Promise<boolean> {
    if (this.#input.cancelBuffered(uuid)) {
      return true;
    }
    return this.#query.cancelAsyncMessage(uuid);
  }

  async interrupt(): Promise<void> {
    if (this.#lifecycle.phase !== "running") {
      throw new AppError({
        code: "SESSION_LIFECYCLE_CONFLICT",
        message: "Only a running Session can be interrupted.",
        status: 409,
        retryable: false,
      });
    }
    this.#setLifecycle({
      phase: "interrupting",
      awaitingUser: this.#lifecycle.awaitingUser,
    });
    try {
      await this.#query.interrupt();
      this.#finishActiveAssistant("interrupted");
      this.#setLifecycle({ phase: "idle", awaitingUser: false });
    } catch (error) {
      this.#setLifecycle({
        phase: "running",
        awaitingUser: this.#lifecycle.awaitingUser,
      });
      throw error;
    }
  }

  close(reason: string): Promise<void> {
    return this.#beginTerminalCleanup({
      reason,
      fromPump: false,
    });
  }

  /** Returns the in-flight terminal cleanup when this controller is closing. */
  termination(): Promise<void> | undefined {
    return this.#closing ? this.#closePromise : undefined;
  }

  lifecycle(): SessionLifecycle {
    return {
      ...this.#lifecycle,
      ...(this.#lifecycle.failure === undefined
        ? {}
        : { failure: { ...this.#lifecycle.failure } }),
    };
  }

  capabilities(): readonly string[] {
    return this.#capabilities;
  }

  query(): QueryPort {
    return this.#query;
  }

  async refreshContext(options: { required: boolean }): Promise<void> {
    const sequence = ++this.#contextRequestSequence;
    const previous = this.#runtimeState.snapshot(this.#sessionId);
    this.#runtimeState.merge(this.#sessionId, { contextStatus: "loading" });
    try {
      const context = await this.#query.getContextUsage();
      if (sequence !== this.#contextRequestSequence) return;
      this.#runtimeState.merge(this.#sessionId, {
        context: projectBrowserRecord(context),
        contextStatus: "ready",
      });
    } catch (error) {
      if (sequence === this.#contextRequestSequence) {
        this.#runtimeState.merge(this.#sessionId, {
          contextStatus:
            previous.context === undefined ? "unsupported" : "ready",
        });
      }
      if (options.required) throw error;
    }
  }

  #beginTerminalCleanup(options: TerminalCleanupOptions): Promise<void> {
    if (this.#closePromise !== undefined) return this.#closePromise;
    let resolveCleanup: (() => void) | undefined;
    let rejectCleanup: ((error: unknown) => void) | undefined;
    const cleanup = new Promise<void>((resolve, reject) => {
      resolveCleanup = resolve;
      rejectCleanup = reject;
    });
    this.#closePromise = cleanup;
    void this.#terminalCleanup(options).then(
      () => resolveCleanup?.(),
      (error) => rejectCleanup?.(error),
    );
    return cleanup;
  }

  async #terminalCleanup(options: TerminalCleanupOptions): Promise<void> {
    this.#closing = true;
    this.#contextRequestSequence += 1;
    const closeError = new AppError({
      code: "SESSION_CLOSED",
      message: options.reason,
      status: 409,
      retryable: true,
    });
    this.#input.close(closeError);
    this.#unsubscribeInput?.();
    this.#unsubscribeInput = undefined;
    this.#unsubscribeInteractions?.();
    this.#unsubscribeInteractions = undefined;
    this.#interactions.abortSession(
      this.#sessionId,
      options.cause instanceof Error ? options.cause : closeError,
    );
    if (options.failure !== undefined) {
      this.#setLifecycle({
        phase: "restorable",
        awaitingUser: false,
        failure: options.failure,
      });
    }
    let closeFailure: unknown;
    let queryClose: Promise<void> | undefined;
    try {
      queryClose = this.#query.close();
    } catch (error) {
      closeFailure = error;
    }
    if (queryClose !== undefined) {
      try {
        await queryClose;
      } catch (error) {
        closeFailure = error;
      }
    }
    if (options.fromPump) {
      this.#releaseRegistry();
    } else {
      await this.#pumpPromise;
      this.#setLifecycle({ phase: "restorable", awaitingUser: false });
      this.#releaseRegistry();
    }
    if (closeFailure !== undefined) {
      throw closeFailure;
    }
  }

  async #pump(): Promise<void> {
    try {
      for await (const message of this.#query) {
        const actions = projectSdkMessage(message, {
          sessionId: this.#sessionId,
          now: this.#now,
          createId: this.#createId,
          includeRawEvents: this.#includeRawEvents,
        });
        for (const action of actions) {
          this.#reduce(action);
        }
      }
      if (!this.#closing) {
        this.#fatal(new Error("The SDK message stream ended unexpectedly."));
      }
    } catch (error) {
      if (!this.#closing) {
        this.#fatal(error);
      }
    }
  }

  #reduce(action: ProjectionAction): void {
    switch (action.type) {
      case "conversation.add":
        if (action.item.kind === "tool") {
          const toolUseId = action.item.toolUseId;
          const existing = [...this.#messages.values()].find(
            (item) =>
              item.kind === "tool" &&
              item.toolUseId === toolUseId,
          );
          if (existing?.kind === "tool") {
            const item: typeof existing = {
              ...existing,
              name: action.item.name,
              input: action.item.input,
              ...(existing.startedAt === undefined &&
              action.item.startedAt !== undefined
                ? { startedAt: action.item.startedAt }
                : {}),
            };
            this.#messages.set(item.id, item);
            this.#publishConversation(item);
            return;
          }
          this.#finishActiveAssistant("complete");
        }
        this.#messages.set(action.item.id, action.item);
        this.#publishConversation(action.item);
        return;
      case "assistant.delta": {
        const itemId = this.#activeAssistantItemId ?? action.sourceId;
        const existing = this.#messages.get(itemId);
        const lastSegment = this.#activeAssistantSegments.at(-1);
        if (lastSegment?.state === "streaming") {
          lastSegment.text += action.text;
        } else {
          this.#activeAssistantSegments.push({
            state: "streaming",
            text: action.text,
          });
        }
        const text = this.#activeAssistantSegments
          .map((segment) => segment.text)
          .join("");
        const item: ConversationItem =
          existing?.kind === "assistant"
            ? {
                ...existing,
                text,
                status: "streaming",
              }
            : {
                id: itemId,
                sessionId: this.#sessionId,
                kind: "assistant",
                text,
                status: "streaming",
                createdAt: this.#now(),
              };
        this.#activeAssistantItemId = item.id;
        this.#messages.set(item.id, item);
        this.#publishConversation(item);
        return;
      }
      case "assistant.finalize": {
        const itemId = this.#activeAssistantItemId ?? action.sourceId;
        const existing = this.#messages.get(itemId);
        const lastIndex = this.#activeAssistantSegments.length - 1;
        const lastSegment = this.#activeAssistantSegments[lastIndex];
        if (lastSegment?.state === "streaming") {
          this.#activeAssistantSegments[lastIndex] = {
            state: "final",
            sourceId: action.sourceId,
            text: action.text,
          };
        } else {
          const repeatedIndex = this.#activeAssistantSegments.findIndex(
            (segment) =>
              segment.state === "final" &&
              segment.sourceId === action.sourceId,
          );
          if (repeatedIndex === -1) {
            this.#activeAssistantSegments.push({
              state: "final",
              sourceId: action.sourceId,
              text: action.text,
            });
          } else {
            this.#activeAssistantSegments[repeatedIndex] = {
              state: "final",
              sourceId: action.sourceId,
              text: action.text,
            };
          }
        }
        const item: ConversationItem = {
          ...(existing?.kind === "assistant"
            ? existing
            : {
                id: itemId,
                sessionId: this.#sessionId,
                kind: "assistant" as const,
                createdAt: this.#now(),
              }),
          text: this.#activeAssistantSegments
            .map((segment) => segment.text)
            .join(""),
          status: "complete",
        };
        this.#activeAssistantItemId = item.id;
        this.#messages.set(item.id, item);
        this.#publishConversation(item);
        return;
      }
      case "conversation.update-tool": {
        const tool = [...this.#messages.values()].find(
          (item) =>
            item.kind === "tool" && item.toolUseId === action.toolUseId,
        );
        if (tool?.kind === "tool") {
          if (
            action.patch.lifecycle === "running" &&
            tool.lifecycle !== "requested"
          ) {
            return;
          }
          const completedAt = action.patch.completedAt;
          const elapsed =
            completedAt === undefined || tool.startedAt === undefined
              ? undefined
              : Date.parse(completedAt) - Date.parse(tool.startedAt);
          const item: typeof tool = {
            ...tool,
            ...action.patch,
            ...(elapsed === undefined || !Number.isFinite(elapsed) || elapsed < 0
              ? {}
              : { durationMs: elapsed }),
          };
          this.#messages.set(item.id, item);
          this.#publishConversation(item);
        }
        return;
      }
      case "task.upsert":
        this.#journal.publish(
          { type: "task.upserted", payload: action.task },
          { sessionId: this.#sessionId },
        );
        return;
      case "task.remove":
        this.#journal.publish(
          {
            type: "task.removed",
            payload: { sessionId: this.#sessionId, taskId: action.taskId },
          },
          { sessionId: this.#sessionId },
        );
        return;
      case "runtime.patch":
        this.#runtimeState.merge(this.#sessionId, action.patch);
        return;
      case "turn.completed":
        this.#finishActiveAssistant(action.success ? "complete" : "failed");
        for (const queued of this.#input.list()) {
          if (queued.state === "delivered") {
            this.#input.acknowledgeDelivered(queued.uuid);
          }
        }
        if (!this.#closing) {
          this.#setLifecycle({ phase: "idle", awaitingUser: false });
          void this.refreshContext({ required: false });
        }
        return;
    }
  }

  #publishConversation(item: ConversationItem): void {
    this.#journal.publish(
      {
        type: "conversation.item",
        payload: { sessionId: this.#sessionId, item },
      },
      { sessionId: this.#sessionId },
    );
  }

  #finishActiveAssistant(
    status: "complete" | "interrupted" | "failed",
  ): void {
    if (this.#activeAssistantItemId === undefined) return;
    const existing = this.#messages.get(this.#activeAssistantItemId);
    this.#activeAssistantItemId = undefined;
    this.#activeAssistantSegments = [];
    if (existing?.kind !== "assistant") return;
    const item: ConversationItem = { ...existing, status };
    this.#messages.set(item.id, item);
    this.#publishConversation(item);
  }

  #fatal(error: unknown): void {
    this.#finishActiveAssistant("interrupted");
    const failure = toWireError(error);
    const cleanup = this.#beginTerminalCleanup({
      reason: "SDK 消息流已终止；再次选择该 Session 可自动重试。",
      fromPump: true,
      failure,
      cause: error,
    });
    void cleanup.catch(() => undefined);
  }

  #releaseRegistry(): void {
    const release = this.#registryRelease;
    this.#registryRelease = undefined;
    release?.();
  }

  #setLifecycle(lifecycle: SessionLifecycle): void {
    this.#lifecycle = lifecycle;
    this.#journal.publish(
      {
        type: "session.lifecycle",
        payload: {
          sessionId: this.#sessionId,
          lifecycle,
        },
      },
      { sessionId: this.#sessionId },
    );
  }
}
