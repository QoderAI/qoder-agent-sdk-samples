import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SDKMessage } from "@qoder-ai/qoder-agent-sdk";
import { createApp } from "../../src/server/app.js";
import type {
  HistoricalMessage,
  SessionCatalog,
  SessionRecord,
} from "../../src/server/services/session-catalog-port.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";
import type {
  QueryFactory,
} from "../../src/server/sdk/query-factory.js";
import type { QueryPort } from "../../src/server/sdk/query-port.js";
import { SessionRegistry } from "../../src/server/sdk/session-registry.js";
import { InteractionBroker } from "../../src/server/sdk/interaction-broker.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { SessionRuntimeState } from "../../src/server/sdk/session-runtime-state.js";
import type { EventEnvelope } from "../../src/shared/events.js";

const workspaceId = "00000000-0000-4000-8000-000000000701";
const sessionId = "00000000-0000-4000-8000-000000000702";
const apps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, StoredWorkspace>();

  constructor(...workspaces: StoredWorkspace[]) {
    for (const workspace of workspaces) {
      this.workspaces.set(workspace.id, workspace);
    }
  }

  async list(): Promise<StoredWorkspace[]> {
    return [...this.workspaces.values()];
  }
  async upsert(workspace: StoredWorkspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }
  async remove(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
  }
}

class FakeCatalog implements SessionCatalog {
  readonly rename = vi.fn(async () => undefined);
  readonly tag = vi.fn(async () => undefined);
  readonly delete = vi.fn(async () => undefined);
  readonly record: SessionRecord;
  readonly subagents = new Map<string, HistoricalMessage[]>();

  constructor(cwd: string) {
    this.record = {
      id: sessionId,
      cwd,
      title: "Inspect repository",
      updatedAt: "2026-08-14T07:00:00.000Z",
    };
  }
  async listForWorkspace(): Promise<SessionRecord[]> {
    return [this.record];
  }
  async get(): Promise<SessionRecord | undefined> {
    return this.record;
  }
  async messages(): Promise<HistoricalMessage[]> {
    return [];
  }
  async fork(): Promise<{ sessionId: string }> {
    return { sessionId: "00000000-0000-4000-8000-000000000703" };
  }
  async listSubagents(): Promise<string[]> {
    return [...this.subagents.keys()];
  }
  async subagentMessages(
    _cwd: string,
    _sessionId: string,
    agentId: string,
  ): Promise<HistoricalMessage[]> {
    return this.subagents.get(agentId) ?? [];
  }
}

class QueryOutput implements AsyncIterable<SDKMessage> {
  #resolve: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  #reject: ((error: unknown) => void) | undefined;
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () =>
        new Promise((resolve, reject) => {
          this.#resolve = resolve;
          this.#reject = reject;
        }),
    };
  }
  fail(error: Error): void {
    this.#reject?.(error);
  }
  end(): void {
    this.#resolve?.({ done: true, value: undefined });
  }
}

function fakeQueryFactory(options: { mcpConnected?: boolean } = {}): {
  factory: QueryFactory;
  create: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  outputs: QueryOutput[];
} {
  const outputs: QueryOutput[] = [];
  const close = vi.fn(async (output: QueryOutput) => output.end());
  const create = vi.fn(() => {
    const output = new QueryOutput();
    outputs.push(output);
    return {
      [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
      initializationResult: async () => ({
        capabilities: ["session_rewind_v1"],
      }),
      mcpServerStatus: async () =>
        options.mcpConnected
          ? [{ name: "fixture-mcp", status: "connected" }]
          : [],
      cancelAsyncMessage: async () => true,
      interrupt: async () => undefined,
      rewindFiles: async () => ({
        canRewind: true,
        filesChanged: ["src/app.ts"],
        insertions: 1,
        deletions: 0,
      }),
      rewind: async () => ({
        status: "ready",
        targetUserMessageId: "00000000-0000-4000-8000-000000000704",
        scope: "both",
        filesChanged: ["src/app.ts"],
        insertions: 1,
        deletions: 0,
        failedFiles: [],
      }),
      close: () => close(output),
    } as unknown as QueryPort;
  });
  return { factory: { create }, create, close, outputs };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
  };
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(message);
}

async function setup(options: {
  workspaceRepository?: WorkspaceRepository;
  directoryPicker?: { pick(): Promise<string | null> };
  mcpConnected?: boolean;
} = {}) {
  const cwd = await realpath(
    await mkdtemp(join(tmpdir(), "qoder-session-api-")),
  );
  temporaryDirectories.push(cwd);
  const workspace: StoredWorkspace = {
    id: workspaceId,
    displayName: basename(cwd),
    path: cwd,
    createdAt: "2026-08-14T06:00:00.000Z",
    updatedAt: "2026-08-14T06:00:00.000Z",
  };
  const journal = new EventJournal({ epoch: "epoch-a", capacity: 100 });
  const interactions = new InteractionBroker({ journal });
  const catalog = new FakeCatalog(cwd);
  const queryFactory = fakeQueryFactory({
    ...(options.mcpConnected === undefined
      ? {}
      : { mcpConnected: options.mcpConnected }),
  });
  const app = await createApp({
    assetRoot: null,
    journal,
    workspaceRepository:
      options.workspaceRepository ?? new MemoryWorkspaceRepository(workspace),
    directoryPicker: options.directoryPicker ?? { pick: async () => null },
    sessionCatalog: catalog,
    queryFactory: queryFactory.factory,
    interactionBroker: interactions,
  });
  apps.push(app);
  return { app, journal, catalog, queryFactory, interactions };
}

function waitForEvent(
  journal: EventJournal,
  predicate: (event: EventEnvelope) => boolean,
): Promise<EventEnvelope> {
  return new Promise((resolve) => {
    const unsubscribe = journal.subscribe((event) => {
      if (predicate(event)) {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

describe("Session commands", () => {
  it("resolves a Subagent transcript by its parent Agent Tool id", async () => {
    const { app, catalog } = await setup();
    catalog.subagents.set("agent-other", [{
      type: "user",
      id: "00000000-0000-4000-8000-000000000710",
      sessionId,
      message: { role: "user", content: "Other instruction" },
      parentToolUseId: "other-tool",
      timestamp: "2026-08-14T07:00:00.000Z",
    }]);
    catalog.subagents.set("agent-match", [
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000711",
        sessionId,
        message: { role: "user", content: "Inspect MCP examples" },
        parentToolUseId: "agent/tool 1",
        timestamp: "2026-08-14T07:00:00.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000712",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Found the examples" }],
        },
        parentToolUseId: "agent/tool 1",
        timestamp: "2026-08-14T07:00:01.000Z",
      },
    ]);

    const ready = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/subagents/by-tool/${encodeURIComponent("agent/tool 1")}`,
    });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      agentId: "agent-match",
      parentToolUseId: "agent/tool 1",
      items: [
        expect.objectContaining({ kind: "user", text: "Inspect MCP examples" }),
        expect.objectContaining({ kind: "assistant", text: "Found the examples" }),
      ],
    });

    const waiting = await app.inject({
      method: "GET",
      url: `/api/sessions/${sessionId}/subagents/by-tool/missing-tool`,
    });
    expect(waiting.statusCode).toBe(200);
    expect(waiting.json()).toEqual({ status: "waiting" });
  });

  it("starts a Session in an explicit Workspace and publishes its first message", async () => {
    const { app, journal, queryFactory } = await setup();
    const userMessage = waitForEvent(
      journal,
      (event) =>
        event.type === "conversation.item" &&
        event.payload.item.kind === "user" &&
        event.payload.item.text === "检查这个项目",
    );
    const queuedInput = waitForEvent(
      journal,
      (event) =>
        event.type === "input.upserted" &&
        event.payload.textPreview === "检查这个项目",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: { workspaceId, text: "检查这个项目" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      workspaceId,
    });
    expect(queryFactory.create).toHaveBeenCalledOnce();
    await expect(userMessage).resolves.toMatchObject({
      type: "conversation.item",
      payload: { item: { kind: "user", text: "检查这个项目" } },
    });
    await expect(queuedInput).resolves.toMatchObject({
      type: "input.upserted",
      payload: {
        priority: "next",
        shouldQuery: true,
      },
    });
  });

  it("starts a Session in a Workspace selected by the native picker", async () => {
    const cwd = await realpath(
      await mkdtemp(join(tmpdir(), "qoder-native-picked-")),
    );
    temporaryDirectories.push(cwd);
    const repository = new MemoryWorkspaceRepository();
    const { app, queryFactory } = await setup({
      workspaceRepository: repository,
      directoryPicker: { pick: async () => cwd },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: { text: "检查原生选择" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      workspaceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect([...repository.workspaces.values()]).toMatchObject([{ path: cwd }]);
    expect(queryFactory.create).toHaveBeenCalledOnce();
  });

  it("reports a cancelled native Workspace selection without creating a Session", async () => {
    const { app, queryFactory } = await setup({
      workspaceRepository: new MemoryWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: { text: "不要发送" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "WORKSPACE_SELECTION_CANCELLED",
      retryable: true,
    });
    expect(queryFactory.create).not.toHaveBeenCalled();
  });

  it("rolls back an MCP-blocked first Send without leaving a retry duplicate", async () => {
    const cwd = await realpath(
      await mkdtemp(join(tmpdir(), "qoder-atomic-start-")),
    );
    temporaryDirectories.push(cwd);
    const workspace: StoredWorkspace = {
      id: workspaceId,
      displayName: basename(cwd),
      path: cwd,
      createdAt: "2026-08-14T06:00:00.000Z",
      updatedAt: "2026-08-14T06:00:00.000Z",
    };
    const records = new Map<string, SessionRecord>();
    const deleteSession = vi.fn(async (_cwd: string, id: string) => {
      records.delete(id);
    });
    const catalog: SessionCatalog = {
      listForWorkspace: async () => [...records.values()],
      get: async (_cwd, id) => records.get(id),
      messages: async () => [],
      rename: async () => undefined,
      tag: async () => undefined,
      fork: async () => ({ sessionId }),
      delete: deleteSession,
      listSubagents: async () => [],
      subagentMessages: async () => [],
    };
    const close = vi.fn(async (output: QueryOutput) => output.end());
    const create = vi.fn((input: Parameters<QueryFactory["create"]>[0]) => {
      const createdSessionId = input.newSessionId;
      if (createdSessionId !== undefined) {
        records.set(createdSessionId, {
          id: createdSessionId,
          cwd,
          title: "新建 Session",
          updatedAt: "2026-08-14T07:00:00.000Z",
        });
      }
      const output = new QueryOutput();
      return {
        [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
        initializationResult: async () => ({ capabilities: [] }),
        mcpServerStatus: async () => [{
          name: "auth-mcp",
          status: "needs-auth",
        }],
        cancelAsyncMessage: async () => false,
        interrupt: async () => undefined,
        close: () => close(output),
      } as unknown as QueryPort;
    });
    const registry = new SessionRegistry();
    const journal = new EventJournal({
      epoch: "epoch-atomic-start",
      capacity: 100,
    });
    const runtimeState = new SessionRuntimeState({ journal });
    const app = await createApp({
      assetRoot: null,
      journal,
      workspaceRepository: new MemoryWorkspaceRepository(workspace),
      directoryPicker: { pick: async () => null },
      sessionCatalog: catalog,
      queryFactory: { create },
      sessionRegistry: registry,
      runtimeState,
    });
    apps.push(app);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/sessions/start",
        payload: { workspaceId, text: "检查 MCP 配置" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "MCP_AUTH_REQUIRED" });

      const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
      expect(snapshot.json()).toMatchObject({
        sessions: [],
        messages: {},
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        runtime: {},
      });
      expect(records.size).toBe(0);
      expect(registry.list()).toHaveLength(0);
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
    expect(deleteSession).toHaveBeenCalledTimes(2);
    const failedSessionIds = create.mock.calls.flatMap(([input]) =>
      input.newSessionId === undefined ? [] : [input.newSessionId],
    );
    expect(failedSessionIds).toHaveLength(2);
    for (const [index, failedSessionId] of failedSessionIds.entries()) {
      expect(runtimeState.merge(failedSessionId, {
        skills: [`rollback-probe-${index}`],
      }).skills).toEqual([`rollback-probe-${index}`]);
    }
    expect(runtimeState.merge(
      "00000000-0000-4000-8000-000000000709",
      { skills: ["unrelated-probe"] },
    ).skills).toEqual(["unrelated-probe"]);
  });

  it("deduplicates concurrent ensure and deletes a live Session", async () => {
    const { app, journal, catalog, queryFactory } = await setup();
    const idle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    const first = app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    const second = app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    expect((await first).statusCode).toBe(202);
    expect((await second).statusCode).toBe(202);
    await idle;
    expect(queryFactory.create).toHaveBeenCalledOnce();

    const order: string[] = [];
    queryFactory.close.mockImplementationOnce(async (output: QueryOutput) => {
      order.push("close");
      output.end();
    });
    catalog.delete.mockImplementationOnce(async () => {
      order.push("catalog.delete");
    });
    const removed = waitForEvent(
      journal,
      (event) => {
        if (
          event.type === "session.removed" &&
          event.payload.sessionId === sessionId
        ) {
          order.push("session.removed");
          return true;
        }
        return false;
      },
    );
    const response = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });
    expect(response.statusCode).toBe(202);
    await removed;
    expect(queryFactory.close).toHaveBeenCalledOnce();
    expect(catalog.delete).toHaveBeenCalledWith(expect.any(String), sessionId);
    expect(order).toEqual(["close", "catalog.delete", "session.removed"]);
  });

  it("closes and removes Workspace Sessions before removing the Workspace", async () => {
    const { app, journal, catalog, queryFactory } = await setup();
    const idle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    await idle;
    const checkpointPreviewed = waitForEvent(
      journal,
      (event) =>
        event.type === "checkpoint.previewed" &&
        event.payload.sessionId === sessionId,
    );
    const checkpointResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/checkpoints/preview`,
      payload: {
        userMessageId: "00000000-0000-4000-8000-000000000704",
        scope: "files",
      },
    });
    expect(checkpointResponse.statusCode).toBe(202);
    await checkpointPreviewed;
    const beforeRemoval = journal.cursor();
    const workspaceRemoved = waitForEvent(
      journal,
      (event) =>
        event.type === "workspace.removed" &&
        event.payload.workspaceId === workspaceId,
    );

    const response = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${workspaceId}`,
    });
    expect(response.statusCode).toBe(202);
    await workspaceRemoved;

    const replay = journal.replay({
      epoch: journal.epoch,
      after: beforeRemoval,
    });
    expect(replay).toMatchObject({ kind: "events" });
    const eventTypes = replay.kind === "events"
      ? replay.events
        .map((event) => event.type)
        .filter((type) =>
          type === "checkpoint.removed" ||
          type === "session.removed" ||
          type === "workspace.removed")
      : [];
    expect(eventTypes).toEqual([
      "checkpoint.removed",
      "session.removed",
      "workspace.removed",
    ]);
    expect(queryFactory.close).toHaveBeenCalledOnce();
    expect(catalog.delete).toHaveBeenCalledWith(expect.any(String), sessionId);
    const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
    expect(snapshot.json()).toMatchObject({ workspaces: [], sessions: [] });
  });

  it("does not let a tag command republish a Session after deletion", async () => {
    const { app, journal, catalog } = await setup();
    const tagGate = deferred<undefined>();
    catalog.tag.mockImplementationOnce(async () => tagGate.promise);
    const tagStarted = app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}/tag`,
      payload: { tag: "late" },
    });
    expect((await tagStarted).statusCode).toBe(202);
    await vi.waitFor(() => expect(catalog.tag).toHaveBeenCalledOnce());

    const removed = waitForEvent(
      journal,
      (event) =>
        event.type === "session.removed" &&
        event.payload.sessionId === sessionId,
    );
    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });
    expect(deletion.statusCode).toBe(202);
    await Promise.resolve();
    expect(catalog.delete).not.toHaveBeenCalled();

    tagGate.resolve(undefined);
    await removed;
    const cursorAfterRemoval = journal.cursor();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replay = journal.replay({
      epoch: journal.epoch,
      after: cursorAfterRemoval,
    });
    expect(replay).toMatchObject({ kind: "events", events: [] });
    const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
    expect(snapshot.json().sessions).toEqual([]);
  });

  it("does not let a rename command republish a Session after deletion", async () => {
    const { app, journal, catalog } = await setup();
    const renameGate = deferred<undefined>();
    catalog.rename.mockImplementationOnce(async () => renameGate.promise);
    const renameStarted = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}/title`,
      payload: { title: "Late title" },
    });
    expect(renameStarted.statusCode).toBe(202);
    await vi.waitFor(() => expect(catalog.rename).toHaveBeenCalledOnce());

    const removed = waitForEvent(
      journal,
      (event) =>
        event.type === "session.removed" &&
        event.payload.sessionId === sessionId,
    );
    const deletion = await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });
    expect(deletion.statusCode).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(catalog.delete).not.toHaveBeenCalled();

    renameGate.resolve(undefined);
    await removed;
    const cursorAfterRemoval = journal.cursor();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replay = journal.replay({
      epoch: journal.epoch,
      after: cursorAfterRemoval,
    });
    expect(replay).toMatchObject({ kind: "events", events: [] });
  });

  it("replaces a fatally ended Query and only the replacement observes new work", async () => {
    const { app, journal, queryFactory, interactions } = await setup();
    const firstIdle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    await firstIdle;

    const fatalCloseGate = deferred<void>();
    queryFactory.close.mockImplementationOnce(async (output: QueryOutput) => {
      await fatalCloseGate.promise;
      output.end();
    });
    const restorable = waitForEvent(
      journal,
      (event) =>
        event.type === "session.lifecycle" &&
        event.payload.sessionId === sessionId &&
        event.payload.lifecycle.phase === "restorable",
    );
    queryFactory.outputs[0]?.fail(new Error("fixture stream failure"));
    await restorable;

    const replacementIdle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    const ensureReplacement = app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryFactory.create).toHaveBeenCalledOnce();
    fatalCloseGate.resolve(undefined);
    expect((await ensureReplacement).statusCode).toBe(202);
    await replacementIdle;
    expect(queryFactory.create).toHaveBeenCalledTimes(2);

    const afterReplacement = journal.cursor();
    const pending = interactions.canUseTool(() => sessionId)(
      "Read",
      { file_path: "README.md" },
      {
        signal: new AbortController().signal,
        toolUseID: "replacement-tool",
      },
    );
    const pendingOutcome = pending.then(
      () => "resolved",
      () => "rejected",
    );
    const interactionReplay = journal.replay({
      epoch: journal.epoch,
      after: afterReplacement,
    });
    expect(interactionReplay).toMatchObject({ kind: "events" });
    if (interactionReplay.kind === "events") {
      expect(interactionReplay.events.filter(
        (event) =>
          event.type === "session.lifecycle" &&
          event.payload.sessionId === sessionId &&
          event.payload.lifecycle.awaitingUser,
      )).toHaveLength(1);
    }
    const beforeMessage = journal.cursor();
    const messageResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/messages`,
      payload: { text: "仅发送给替代 Query" },
    });
    expect(messageResponse.statusCode).toBe(202);
    await waitFor(
      () => {
        const replay = journal.replay({
          epoch: journal.epoch,
          after: beforeMessage,
        });
        return replay.kind === "events" && replay.events.some(
          (event) =>
            event.type === "input.upserted" &&
            event.payload.textPreview === "仅发送给替代 Query",
        );
      },
      "replacement input was not projected",
    );

    const replay = journal.replay({
      epoch: journal.epoch,
      after: beforeMessage,
    });
    expect(replay).toMatchObject({ kind: "events" });
    if (replay.kind === "events") {
      expect(replay.events.filter(
        (event) =>
          event.type === "input.upserted" &&
          event.payload.textPreview === "仅发送给替代 Query",
      )).toHaveLength(1);
    }
    expect(queryFactory.close).toHaveBeenCalledOnce();
    interactions.abortSession(sessionId, new Error("test complete"));
    expect(await pendingOutcome).toBe("rejected");
  });

  it("does not delete a fatally ended Session until Query close settles", async () => {
    const { app, journal, catalog, queryFactory } = await setup();
    const firstIdle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    await firstIdle;

    const fatalCloseGate = deferred<void>();
    queryFactory.close.mockImplementationOnce(async (output: QueryOutput) => {
      await fatalCloseGate.promise;
      output.end();
    });
    const restorable = waitForEvent(
      journal,
      (event) =>
        event.type === "session.lifecycle" &&
        event.payload.sessionId === sessionId &&
        event.payload.lifecycle.phase === "restorable",
    );
    queryFactory.outputs[0]?.fail(new Error("fixture stream failure"));
    await restorable;

    const deletion = app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(catalog.delete).not.toHaveBeenCalled();

    fatalCloseGate.resolve(undefined);
    expect((await deletion).statusCode).toBe(202);
    await waitFor(
      () => catalog.delete.mock.calls.length === 1,
      "Session deletion did not continue after Query close settled",
    );
    expect(catalog.delete).toHaveBeenCalledOnce();
  });

  it("rejects a missing Session before command acceptance", async () => {
    const { app } = await setup();

    const response = await app.inject({
      method: "POST",
      url: "/api/sessions/00000000-0000-4000-8000-000000000799/ensure",
      payload: {},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "SESSION_NOT_FOUND" });
  });

  it("serializes delete ahead of a concurrent MCP reconnect without recreating the Session", async () => {
    const { app, journal, queryFactory } = await setup({ mcpConnected: true });
    const idle = waitForEvent(
      journal,
      (event) =>
        event.type === "session.upserted" &&
        event.payload.id === sessionId &&
        event.payload.phase === "idle",
    );
    await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    await idle;

    const closeGate = deferred<void>();
    queryFactory.close.mockImplementationOnce(async (output: QueryOutput) => {
      await closeGate.promise;
      output.end();
    });
    const removed = waitForEvent(
      journal,
      (event) =>
        event.type === "session.removed" &&
        event.payload.sessionId === sessionId,
    );
    expect((await app.inject({
      method: "DELETE",
      url: `/api/sessions/${sessionId}`,
    })).statusCode).toBe(202);
    await waitFor(
      () => queryFactory.close.mock.calls.length === 1,
      "delete did not start closing the live Query",
    );
    const reconnectFailed = waitForEvent(
      journal,
      (event) =>
        event.type === "command.failed" && event.sessionId === sessionId,
    );
    expect((await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/mcp/fixture-mcp/reconnect`,
      payload: {},
    })).statusCode).toBe(202);

    closeGate.resolve(undefined);
    await removed;
    await reconnectFailed;
    await waitFor(
      () => queryFactory.create.mock.calls.length >= 1,
      "initial Query was not observed",
    );
    const snapshot = await app.inject({ method: "GET", url: "/api/snapshot" });
    expect(snapshot.json().sessions).toEqual([]);
    expect(queryFactory.create).toHaveBeenCalledOnce();
  });

});
