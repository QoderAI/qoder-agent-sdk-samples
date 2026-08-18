import { randomUUID } from "node:crypto";
import type { SendMessageCommand } from "../../shared/commands.js";
import type { SessionView, WorkspaceView } from "../../shared/model.js";
import type { SelectablePermissionMode } from "../../shared/permissions.js";
import { AppError, toWireError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import { InputQueue } from "../sdk/input-queue.js";
import type { InteractionBroker } from "../sdk/interaction-broker.js";
import type { McpService } from "../sdk/mcp-service.js";
import type { SessionRuntimeState } from "../sdk/session-runtime-state.js";
import type {
  CreateQueryInput,
  QueryFactory,
} from "../sdk/query-factory.js";
import { SessionController } from "../sdk/session-controller.js";
import type { SessionRegistry } from "../sdk/session-registry.js";
import type { SessionCatalog, SessionRecord } from "./session-catalog-port.js";
import type { SnapshotService } from "./snapshot-service.js";

type CreateSessionInput = {
  model?: string | undefined;
  permissionMode?: SelectablePermissionMode | undefined;
};

type ForkSessionInput = {
  upToMessageId?: string | undefined;
  title?: string | undefined;
};

/** Owns Session validation, SDK Query lifetimes, and durable metadata commands. */
export class SessionService {
  readonly #catalog: SessionCatalog;
  readonly #queryFactory: QueryFactory;
  readonly #registry: SessionRegistry;
  readonly #interactions: InteractionBroker;
  readonly #journal: EventJournal;
  readonly #snapshots: SnapshotService;
  readonly #mcp: McpService;
  readonly #runtimeState: SessionRuntimeState;
  readonly #mcpServersForWorkspace: (
    workspacePath: string,
  ) => CreateQueryInput["mcpServers"];
  readonly #hooksForSession: (
    getSessionId: () => string,
  ) => CreateQueryInput["hooks"];
  readonly #createUuid: () => string;
  readonly #now: () => string;
  readonly #defaultModel: string;
  readonly #defaultPermissionMode: SelectablePermissionMode;
  readonly #includeRawEvents: boolean;
  readonly #withWorkspace: <T>(
    workspaceId: string,
    operation: (workspace: WorkspaceView) => Promise<T>,
  ) => Promise<T>;
  readonly #clearCheckpoints: (sessionId: string) => void;

  constructor(options: {
    catalog: SessionCatalog;
    queryFactory: QueryFactory;
    registry: SessionRegistry;
    interactions: InteractionBroker;
    journal: EventJournal;
    snapshots: SnapshotService;
    mcp: McpService;
    runtimeState: SessionRuntimeState;
    mcpServersForWorkspace?: (
      workspacePath: string,
    ) => CreateQueryInput["mcpServers"];
    hooksForSession?: (
      getSessionId: () => string,
    ) => CreateQueryInput["hooks"];
    createUuid?: () => string;
    now?: () => string;
    defaultModel?: string;
    defaultPermissionMode?: SelectablePermissionMode;
    withWorkspace: <T>(
      workspaceId: string,
      operation: (workspace: WorkspaceView) => Promise<T>,
    ) => Promise<T>;
    clearCheckpoints: (sessionId: string) => void;
    includeRawEvents?: boolean;
  }) {
    this.#catalog = options.catalog;
    this.#queryFactory = options.queryFactory;
    this.#registry = options.registry;
    this.#interactions = options.interactions;
    this.#journal = options.journal;
    this.#snapshots = options.snapshots;
    this.#mcp = options.mcp;
    this.#runtimeState = options.runtimeState;
    this.#mcpServersForWorkspace =
      options.mcpServersForWorkspace ?? (() => ({}));
    this.#hooksForSession = options.hooksForSession ?? (() => ({}));
    this.#createUuid = options.createUuid ?? randomUUID;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#defaultModel = options.defaultModel ?? "auto";
    this.#defaultPermissionMode = options.defaultPermissionMode ?? "default";
    this.#withWorkspace = options.withWorkspace;
    this.#clearCheckpoints = options.clearCheckpoints;
    this.#includeRawEvents = options.includeRawEvents ?? true;
  }

  requireWorkspace(workspaceId: string): WorkspaceView {
    const workspace = this.#snapshots.workspace(workspaceId);
    if (workspace === undefined) {
      throw new AppError({
        code: "WORKSPACE_NOT_FOUND",
        message: "The selected Workspace no longer exists.",
        status: 404,
        retryable: false,
      });
    }
    return workspace;
  }

  requireSession(sessionId: string): SessionView {
    const session = this.#snapshots.session(sessionId);
    if (session === undefined) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The selected Session no longer exists.",
        status: 404,
        retryable: false,
      });
    }
    return session;
  }

  requireLive(sessionId: string): SessionController {
    this.requireSession(sessionId);
    const controller = this.#registry.get(sessionId);
    if (controller === undefined) {
      throw new AppError({
        code: "SESSION_NOT_LIVE",
        message: "此 Session 当前不可用。请重新选择该 Session 以自动重试。",
        status: 409,
        retryable: true,
      });
    }
    return controller;
  }

  requireRestorable(sessionId: string): SessionView {
    const session = this.requireSession(sessionId);
    if (this.#registry.get(sessionId) !== undefined) {
      throw new AppError({
        code: "SESSION_ALREADY_LIVE",
        message: "This Session already has a live SDK Query.",
        status: 409,
        retryable: false,
      });
    }
    return session;
  }

  async createWithInitialMessage(
    workspaceId: string,
    input: CreateSessionInput,
    message: SendMessageCommand,
  ): Promise<string> {
    return this.#create(workspaceId, input, message);
  }

  async #create(
    workspaceId: string,
    input: CreateSessionInput,
    initialMessage?: SendMessageCommand,
  ): Promise<string> {
    return this.#withWorkspace(workspaceId, async (workspace) => {
      const sessionId = this.#createUuid();
      const timestamp = this.#now();
      const view: SessionView = {
        id: sessionId,
        workspaceId: workspace.id,
        title: "新建 Session",
        cwd: workspace.path,
        phase: "starting",
        awaitingUser: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.#registry.runExclusive(sessionId, async () => {
        await this.#startController(
          view,
          {
            newSessionId: sessionId,
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.permissionMode === undefined
              ? {}
              : { permissionMode: input.permissionMode }),
          },
          initialMessage,
        );
      });
      return sessionId;
    });
  }

  ensureAvailable(sessionId: string): Promise<void> {
    return this.#registry.runExclusive(sessionId, async () => {
      const existing = this.#registry.get(sessionId);
      const termination = existing?.termination();
      if (existing !== undefined && termination === undefined) return;
      await termination;
      await this.#resumeUnlocked(sessionId);
    });
  }

  send(sessionId: string, input: SendMessageCommand): void {
    const controller = this.requireLive(sessionId);
    this.#enqueueMessage(controller, sessionId, input);
  }

  #enqueueMessage(
    controller: SessionController,
    sessionId: string,
    input: SendMessageCommand,
  ): void {
    const queued = controller.send(input);
    this.#journal.publish(
      {
        type: "conversation.item",
        payload: {
          sessionId,
          item: {
            id: queued.uuid,
            sessionId,
            kind: "user",
            text: input.text,
            messageUuid: queued.uuid,
            createdAt: this.#now(),
          },
        },
      },
      { sessionId },
    );
  }

  async cancelMessage(sessionId: string, messageUuid: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      const cancelled = await this.requireLive(sessionId).cancelMessage(
        messageUuid,
      );
      if (!cancelled) {
        throw new AppError({
          code: "MESSAGE_NOT_FOUND",
          message: "The queued or delivered message could not be cancelled.",
          status: 404,
          retryable: false,
        });
      }
    });
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      await this.requireLive(sessionId).interrupt();
    });
  }

  async restartForMcp(sessionId: string): Promise<void> {
    await this.#registry.runExclusive(sessionId, async () => {
      await this.#restartForMcpUnlocked(sessionId);
    });
  }

  async #resumeUnlocked(sessionId: string): Promise<void> {
    const view = this.requireRestorable(sessionId);
    await this.#startController(view, { resumeSessionId: sessionId });
  }

  async #restartForMcpUnlocked(sessionId: string): Promise<void> {
    const view = this.requireSession(sessionId);
    await this.requireLive(sessionId).close(
      "Restarting the Session to reconnect MCP servers.",
    );
    const restorable: SessionView = {
      ...view,
      phase: "restorable",
      awaitingUser: false,
      updatedAt: this.#now(),
    };
    this.#publishSession(restorable);
    await this.#startController(restorable, { resumeSessionId: sessionId });
  }

  async rename(sessionId: string, title: string): Promise<void> {
    await this.#registry.runExclusive(sessionId, async () => {
      const view = this.requireSession(sessionId);
      await this.#catalog.rename(view.cwd, sessionId, title);
      await this.#refresh(view, { title });
    });
  }

  async tag(sessionId: string, tag: string): Promise<void> {
    await this.#registry.runExclusive(sessionId, async () => {
      const view = this.requireSession(sessionId);
      await this.#catalog.tag(view.cwd, sessionId, tag);
      await this.#refresh(view, { tag });
    });
  }

  async refreshMetadata(sessionId: string, title?: string): Promise<void> {
    await this.#registry.runExclusive(sessionId, async () => {
      const view = this.requireSession(sessionId);
      await this.#refresh(
        view,
        title === undefined ? {} : { title },
      );
    });
  }

  async fork(
    sessionId: string,
    input: ForkSessionInput,
  ): Promise<string> {
    const source = this.requireSession(sessionId);
    return this.#withWorkspace(source.workspaceId, async () =>
      this.#registry.runExclusive(sessionId, async () => {
        const current = this.requireSession(sessionId);
        const result = await this.#catalog.fork(current.cwd, sessionId, {
          ...(input.upToMessageId === undefined
            ? {}
            : { upToMessageId: input.upToMessageId }),
          ...(input.title === undefined ? {} : { title: input.title }),
        });
        const record = await this.#catalog.get(current.cwd, result.sessionId);
        const next =
          record === undefined
            ? {
                ...current,
                id: result.sessionId,
                title: input.title ?? `${current.title} (fork)`,
                phase: "restorable" as const,
                awaitingUser: false,
                updatedAt: this.#now(),
              }
            : this.#fromRecord(current.workspaceId, record);
        this.#publishSession(next);
        return result.sessionId;
      }));
  }

  async delete(sessionId: string): Promise<void> {
    await this.#registry.runExclusive(sessionId, async () => {
      await this.#deleteUnlocked(sessionId);
    });
  }

  async #deleteUnlocked(sessionId: string): Promise<void> {
    const view = this.requireSession(sessionId);
    await this.#registry.get(sessionId)?.close("Session deleted by the user.");
    await this.#catalog.delete(view.cwd, sessionId);
    this.#mcp.clearSession(sessionId);
    this.#clearCheckpoints(sessionId);
    this.#publishRemoval(sessionId);
  }

  /** Closes and removes all durable Sessions owned by one locked Workspace. */
  async deleteWorkspaceSessions(workspace: WorkspaceView): Promise<void> {
    const records = await this.#catalog.listForWorkspace(workspace.path);
    await Promise.all(records.map((record) =>
      this.#registry.runExclusive(record.id, async () => {
        await this.#registry.get(record.id)?.close(
          "Workspace deleted by the user.",
        );
        await this.#catalog.delete(workspace.path, record.id);
        this.#mcp.clearSession(record.id);
        this.#clearCheckpoints(record.id);
        this.#publishRemoval(record.id);
      })));
  }

  async #startController(
    view: SessionView,
    lifecycle: {
      newSessionId?: string;
      resumeSessionId?: string;
      model?: string;
      permissionMode?: SelectablePermissionMode;
    },
    initialMessage?: SendMessageCommand,
  ): Promise<void> {
    if (this.#registry.get(view.id) !== undefined) {
      throw new AppError({
        code: "SESSION_ALREADY_LIVE",
        message: "This Session already has a live SDK Query.",
        status: 409,
        retryable: false,
      });
    }
    const input = new InputQueue();
    const getSessionId = () => view.id;
    const query = this.#queryFactory.create({
      workspacePath: view.cwd,
      input,
      interactions: this.#interactions,
      getSessionId,
      mcpServers: this.#mcpServersForWorkspace(view.cwd),
      hooks: this.#hooksForSession(getSessionId),
      ...lifecycle,
    });
    const controller = new SessionController({
      initialModel: lifecycle.model ?? this.#defaultModel,
      initialPermissionMode:
        lifecycle.permissionMode ?? this.#defaultPermissionMode,
      sessionId: view.id,
      query,
      input,
      interactions: this.#interactions,
      journal: this.#journal,
      mcp: this.#mcp,
      runtimeState: this.#runtimeState,
      includeRawEvents: this.#includeRawEvents,
    });
    const release = this.#registry.reserve(view.id, controller);
    controller.attachRegistryRelease(release);
    try {
      const initialized = await controller.start();
      if (initialMessage !== undefined) {
        this.#enqueueMessage(controller, view.id, initialMessage);
      }
      this.#publishSession({
        ...view,
        phase: "idle",
        awaitingUser: false,
        capabilities: initialized.capabilities,
        updatedAt: this.#now(),
      });
    } catch (error) {
      if (lifecycle.newSessionId !== undefined) {
        const cleanupErrors: unknown[] = [];
        try {
          await controller.close("Session startup failed.");
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        } finally {
          release();
        }
        try {
          await this.#catalog.delete(view.cwd, view.id);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        this.#mcp.clearSession(view.id);
        this.#publishRemoval(view.id);
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Session startup failed and rollback was incomplete.",
          );
        }
        this.#runtimeState.discardUnpublishedSession(view.id);
        throw error;
      }
      release();
      await controller.close("Session startup failed.").catch(() => undefined);
      this.#publishSession({
        ...view,
        phase: "restorable",
        awaitingUser: false,
        failure: toWireError(error),
        updatedAt: this.#now(),
      });
      throw error;
    }
  }

  async #refresh(
    current: SessionView,
    fallback: Partial<Pick<SessionView, "title" | "tag">>,
  ): Promise<void> {
    const record = await this.#catalog.get(current.cwd, current.id);
    this.#publishSession(
      record === undefined
        ? { ...current, ...fallback, updatedAt: this.#now() }
        : this.#fromRecord(current.workspaceId, record),
    );
  }

  #fromRecord(workspaceId: string, record: SessionRecord): SessionView {
    return {
      id: record.id,
      workspaceId,
      title: record.title.trim() || "未命名 Session",
      cwd: record.cwd,
      phase: "restorable",
      awaitingUser: false,
      updatedAt: record.updatedAt,
      ...(record.createdAt === undefined
        ? {}
        : { createdAt: record.createdAt }),
      ...(record.tag === undefined ? {} : { tag: record.tag }),
      ...(record.gitBranch === undefined
        ? {}
        : { gitBranch: record.gitBranch }),
    };
  }

  #publishSession(view: SessionView): void {
    this.#journal.publish(
      { type: "session.upserted", payload: view },
      { sessionId: view.id },
    );
  }

  #publishRemoval(sessionId: string): void {
    this.#journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );
  }
}
