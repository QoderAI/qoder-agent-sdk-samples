import type { EventEnvelope } from "../../shared/events.js";
import type {
  ConversationItem,
  CheckpointPreviewView,
  SessionRuntimeView,
  InteractionView,
  McpServerView,
  QueuedInputView,
  SessionView,
  TaskView,
  WorkspaceView,
} from "../../shared/model.js";
import {
  appSnapshotSchema,
  type AppSnapshot,
} from "../../shared/snapshots.js";
import { AppError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import { projectHistory } from "../sdk/history-projector.js";
import type { SessionCatalog } from "./session-catalog-port.js";
import type { WorkspaceService } from "./workspace-service.js";

function sessionView(
  workspace: WorkspaceView,
  record: Awaited<ReturnType<SessionCatalog["listForWorkspace"]>>[number],
): SessionView {
  return {
    id: record.id,
    workspaceId: workspace.id,
    title: record.title.trim() || "未命名 Session",
    cwd: record.cwd,
    phase: "restorable",
    awaitingUser: false,
    updatedAt: record.updatedAt,
    ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt }),
    ...(record.tag === undefined ? {} : { tag: record.tag }),
    ...(record.gitBranch === undefined
      ? {}
      : { gitBranch: record.gitBranch }),
  };
}

type ConversationMutation = {
  sequence: number;
  item: ConversationItem;
};

type HistoryState = {
  generation: number;
  status: "unloaded" | "loading" | "loaded";
  pending: ConversationMutation[];
  inFlight?: Promise<void>;
};

function upsertConversationItem(
  items: readonly ConversationItem[],
  item: ConversationItem,
): ConversationItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  const next = [...items];
  if (index === -1) {
    next.push(item);
  } else {
    next[index] = item;
  }
  return next;
}

/** Maintains the browser-facing projection and rebuilds durable state at startup. */
export class SnapshotService {
  readonly #workspaceService: WorkspaceService;
  readonly #sessionCatalog: SessionCatalog;
  readonly #journal: EventJournal;
  readonly #workspaces = new Map<string, WorkspaceView>();
  readonly #sessions = new Map<string, SessionView>();
  readonly #messages = new Map<string, ConversationItem[]>();
  readonly #historyStates = new Map<string, HistoryState>();
  readonly #historyGenerations = new Map<string, number>();
  readonly #queuedInputs = new Map<string, QueuedInputView>();
  readonly #interactions = new Map<string, InteractionView>();
  readonly #tasks = new Map<string, TaskView>();
  readonly #mcpServers = new Map<string, McpServerView>();
  readonly #checkpointPreviews = new Map<string, CheckpointPreviewView>();
  readonly #runtime = new Map<string, SessionRuntimeView>();
  readonly #unsubscribe: () => void;

  constructor(options: {
    workspaceService: WorkspaceService;
    sessionCatalog: SessionCatalog;
    journal: EventJournal;
  }) {
    this.#workspaceService = options.workspaceService;
    this.#sessionCatalog = options.sessionCatalog;
    this.#journal = options.journal;
    this.#unsubscribe = this.#journal.subscribe((event) => this.#apply(event));
  }

  /** Loads Workspace and Session metadata without starting any SDK Query. */
  async hydrate(): Promise<void> {
    this.#workspaces.clear();
    this.#sessions.clear();
    this.#messages.clear();
    this.#historyStates.clear();
    const workspaces = await this.#workspaceService.list();
    for (const workspace of workspaces) {
      this.#workspaces.set(workspace.id, workspace);
      const records = await this.#sessionCatalog.listForWorkspace(
        workspace.path,
      );
      for (const record of records) {
        this.#sessions.set(record.id, sessionView(workspace, record));
        this.#historyState(record.id);
      }
    }
  }

  /** Loads one selected transcript on demand, preserving stored timestamps. */
  async loadSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      throw this.#sessionNotFound();
    }
    const state = this.#historyState(sessionId);
    if (state.status === "loaded") {
      return;
    }
    if (state.inFlight !== undefined) {
      await state.inFlight;
      if (!this.#sessions.has(sessionId)) {
        throw this.#sessionNotFound();
      }
      return;
    }

    state.status = "loading";
    const generation = state.generation;
    const load = (async () => {
      try {
        const history = await this.#sessionCatalog.messages(
          session.cwd,
          sessionId,
        );
        if (
          this.#historyStates.get(sessionId) !== state ||
          state.generation !== generation
        ) {
          return;
        }
        let messages = projectHistory(history);
        for (const mutation of state.pending.sort(
          (left, right) => left.sequence - right.sequence,
        )) {
          messages = upsertConversationItem(messages, mutation.item);
        }
        this.#messages.set(sessionId, messages);
        state.pending = [];
        state.status = "loaded";
      } catch (error) {
        if (this.#historyStates.get(sessionId) === state) {
          state.status = "unloaded";
        }
        throw error;
      } finally {
        if (this.#historyStates.get(sessionId) === state) {
          delete state.inFlight;
        }
      }
    })();
    state.inFlight = load;
    await load;
    if (!this.#sessions.has(sessionId)) {
      throw this.#sessionNotFound();
    }
  }

  /** Returns a validated snapshot, with history only for the selected Session. */
  async snapshot(selectedSessionId?: string): Promise<AppSnapshot> {
    if (selectedSessionId !== undefined) {
      await this.loadSession(selectedSessionId);
    }
    return appSnapshotSchema.parse({
      serverEpoch: this.#journal.epoch,
      cursor: this.#journal.cursor(),
      workspaces: [...this.#workspaces.values()],
      sessions: [...this.#sessions.values()],
      messages:
        selectedSessionId === undefined
          ? {}
          : {
              [selectedSessionId]: this.#messages.get(selectedSessionId) ?? [],
            },
      queuedInputs: [...this.#queuedInputs.values()],
      interactions: [...this.#interactions.values()],
      tasks: [...this.#tasks.values()],
      mcpServers: [...this.#mcpServers.values()],
      checkpointPreviews: [...this.#checkpointPreviews.values()],
      runtime: Object.fromEntries(this.#runtime),
    });
  }

  workspace(workspaceId: string): WorkspaceView | undefined {
    return this.#workspaces.get(workspaceId);
  }

  session(sessionId: string): SessionView | undefined {
    return this.#sessions.get(sessionId);
  }

  tasks(sessionId: string): TaskView[] {
    return [...this.#tasks.values()].filter(
      (task) => task.sessionId === sessionId,
    );
  }

  close(): void {
    this.#unsubscribe();
  }

  #apply(event: EventEnvelope): void {
    switch (event.type) {
      case "workspace.upserted":
        this.#workspaces.set(event.payload.id, event.payload);
        return;
      case "workspace.removed":
        this.#workspaces.delete(event.payload.workspaceId);
        for (const session of this.#sessions.values()) {
          if (session.workspaceId === event.payload.workspaceId) {
            this.#removeSession(session.id);
          }
        }
        return;
      case "session.upserted":
        this.#sessions.set(event.payload.id, event.payload);
        this.#historyState(event.payload.id);
        return;
      case "session.removed":
        this.#removeSession(event.payload.sessionId);
        return;
      case "session.lifecycle": {
        const current = this.#sessions.get(event.payload.sessionId);
        if (current !== undefined) {
          this.#sessions.set(current.id, {
            ...current,
            phase: event.payload.lifecycle.phase,
            awaitingUser: event.payload.lifecycle.awaitingUser,
            ...(event.payload.lifecycle.failure === undefined
              ? { failure: undefined }
              : { failure: event.payload.lifecycle.failure }),
          });
        }
        return;
      }
      case "conversation.item": {
        const sessionId = event.payload.sessionId;
        if (!this.#sessions.has(sessionId)) {
          return;
        }
        const state = this.#historyState(sessionId);
        if (state.status === "loaded") {
          this.#messages.set(
            sessionId,
            upsertConversationItem(
              this.#messages.get(sessionId) ?? [],
              event.payload.item,
            ),
          );
        } else {
          state.pending.push({
            sequence: event.sequence,
            item: event.payload.item,
          });
        }
        return;
      }
      case "conversation.replaced": {
        const sessionId = event.payload.sessionId;
        if (!this.#sessions.has(sessionId)) {
          return;
        }
        const state: HistoryState = {
          generation: this.#nextHistoryGeneration(sessionId),
          status: "loaded",
          pending: [],
        };
        this.#historyStates.set(sessionId, state);
        this.#messages.set(sessionId, [...event.payload.items]);
        return;
      }
      case "interaction.opened":
        this.#interactions.set(event.payload.id, event.payload);
        return;
      case "interaction.resolved":
        this.#interactions.delete(event.payload.interactionId);
        return;
      case "input.upserted":
        this.#queuedInputs.set(event.payload.uuid, event.payload);
        return;
      case "input.removed":
        this.#queuedInputs.delete(event.payload.messageUuid);
        return;
      case "task.upserted":
        this.#tasks.set(
          `${event.payload.sessionId}:${event.payload.taskId}`,
          event.payload,
        );
        return;
      case "task.removed":
        this.#tasks.delete(
          `${event.payload.sessionId}:${event.payload.taskId}`,
        );
        return;
      case "mcp.status":
        this.#mcpServers.set(
          `${event.payload.sessionId}:${event.payload.name}`,
          event.payload,
        );
        return;
      case "runtime.updated":
        this.#runtime.set(
          event.payload.sessionId,
          event.payload.runtime,
        );
        return;
      case "checkpoint.previewed":
        this.#checkpointPreviews.set(event.payload.id, event.payload);
        return;
      case "checkpoint.removed":
        this.#checkpointPreviews.delete(event.payload.previewId);
        return;
      case "checkpoint.completed":
      case "command.failed":
        return;
    }
  }

  #historyState(sessionId: string): HistoryState {
    const existing = this.#historyStates.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const state: HistoryState = {
      generation: this.#nextHistoryGeneration(sessionId),
      status: "unloaded",
      pending: [],
    };
    this.#historyStates.set(sessionId, state);
    return state;
  }

  #nextHistoryGeneration(sessionId: string): number {
    const generation = (this.#historyGenerations.get(sessionId) ?? 0) + 1;
    this.#historyGenerations.set(sessionId, generation);
    return generation;
  }

  #sessionNotFound(): AppError {
    return new AppError({
      code: "SESSION_NOT_FOUND",
      message: "The selected Session no longer exists.",
      status: 404,
      retryable: false,
    });
  }

  #removeSession(sessionId: string): void {
    this.#sessions.delete(sessionId);
    this.#messages.delete(sessionId);
    this.#historyStates.delete(sessionId);
    this.#nextHistoryGeneration(sessionId);
    this.#runtime.delete(sessionId);
    for (const [key, input] of this.#queuedInputs) {
      if (input.sessionId === sessionId) this.#queuedInputs.delete(key);
    }
    for (const [key, interaction] of this.#interactions) {
      if (interaction.sessionId === sessionId) this.#interactions.delete(key);
    }
    for (const [key, task] of this.#tasks) {
      if (task.sessionId === sessionId) this.#tasks.delete(key);
    }
    for (const [key, server] of this.#mcpServers) {
      if (server.sessionId === sessionId) this.#mcpServers.delete(key);
    }
    for (const [key, preview] of this.#checkpointPreviews) {
      if (preview.sessionId === sessionId) this.#checkpointPreviews.delete(key);
    }
  }
}
