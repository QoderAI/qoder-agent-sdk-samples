import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { createApp } from "../../src/server/app.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { SessionRuntimeState } from "../../src/server/sdk/session-runtime-state.js";
import {
  createInitialState,
  reduceServerFrame,
} from "../../src/client/store/app-reducer.js";
import { serverFrameSchema, type ServerFrame } from "../../src/shared/frames.js";
import {
  FixtureSessionCatalog,
  FixtureWorkspaceRepository,
} from "../fixtures/fake-sdk-runtime.js";

const allowedOrigin = "http://127.0.0.1:5173";
const workspaceId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
let app: FastifyInstance | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  await app?.close();
  app = undefined;
});

function nextFrame(socket: WebSocket): Promise<ServerFrame> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      try {
        resolve(serverFrameSchema.parse(JSON.parse(data.toString())));
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
  });
}

async function connect(
  url: string,
  origin = allowedOrigin,
): Promise<{ socket: WebSocket; firstFrame: ServerFrame }> {
  const socket = new WebSocket(url, { headers: { Origin: origin } });
  sockets.push(socket);
  const frame = nextFrame(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { socket, firstFrame: await frame };
}

describe("realtime hub", () => {
  it("sends a snapshot and replays ordered events after reconnect", async () => {
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 10 });
    app = await createApp({
      assetRoot: null,
      journal,
      allowedOrigins: new Set([allowedOrigin]),
      getSnapshot: () => ({
        serverEpoch: journal.epoch,
        cursor: journal.cursor(),
        workspaces: [],
        sessions: [],
        messages: {},
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        checkpointPreviews: [],
        runtime: {},
      }),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const first = await connect(address.replace("http:", "ws:") + "/ws");
    expect(first.firstFrame.kind).toBe("snapshot");
    const liveFrame = nextFrame(first.socket);
    const published = journal.publish({
      type: "workspace.removed",
      payload: { workspaceId },
    });
    expect(await liveFrame).toEqual({ kind: "events", events: [published] });
    first.socket.close();

    const replay = await connect(
      address.replace("http:", "ws:") + "/ws?epoch=epoch-a&after=0",
    );
    expect(replay.firstFrame).toEqual({
      kind: "events",
      events: [published],
    });
  });

  it("replays a real Runtime update in order and removes Session-associated state", async () => {
    const journal = new EventJournal({
      epoch: "epoch-runtime-order",
      capacity: 10,
      now: () => "2026-08-15T08:00:00.000Z",
    });
    const runtimeState = new SessionRuntimeState({ journal });
    app = await createApp({
      assetRoot: null,
      journal,
      allowedOrigins: new Set([allowedOrigin]),
      getSnapshot: () => ({
        serverEpoch: journal.epoch,
        cursor: journal.cursor(),
        workspaces: [],
        sessions: [],
        messages: {},
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        checkpointPreviews: [],
        runtime: {},
      }),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    journal.publish(
      {
        type: "session.upserted",
        payload: {
          id: sessionId,
          workspaceId,
          title: "Runtime order",
          cwd: "/repo",
          phase: "idle",
          awaitingUser: false,
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
      },
      { sessionId },
    );
    runtimeState.merge(sessionId, {
      versions: { sdk: "fixture-sdk" },
      hooks: [{ event: "SessionStart" }],
    });
    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );

    const replay = await connect(
      address.replace("http:", "ws:") +
        "/ws?epoch=epoch-runtime-order&after=0",
    );
    expect(replay.firstFrame.kind).toBe("events");
    if (replay.firstFrame.kind !== "events") return;
    expect(replay.firstFrame.events.map((event) => event.type)).toEqual([
      "session.upserted",
      "runtime.updated",
      "session.removed",
    ]);
    expect(replay.firstFrame.events.map((event) => event.sequence)).toEqual([
      1, 2, 3,
    ]);
    expect(replay.firstFrame.events[1]).toMatchObject({
      type: "runtime.updated",
      payload: {
        sessionId,
        runtime: {
          versions: { sdk: "fixture-sdk" },
          hooks: [{ event: "SessionStart" }],
        },
      },
    });
    expect(JSON.stringify(replay.firstFrame)).not.toContain("inspector");

    const hydrated = reduceServerFrame(createInitialState(), {
      kind: "snapshot",
      snapshot: {
        serverEpoch: journal.epoch,
        cursor: 0,
        workspaces: [],
        sessions: [],
        messages: {},
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        checkpointPreviews: [],
        runtime: {},
      },
    }).state;
    const beforeRemoval = reduceServerFrame(hydrated, {
      kind: "events",
      events: replay.firstFrame.events.slice(0, 2),
    }).state;
    expect(beforeRemoval.sessions[sessionId]).toBeDefined();
    expect(beforeRemoval.runtime[sessionId]).toMatchObject({
      versions: { sdk: "fixture-sdk" },
    });

    const afterRemoval = reduceServerFrame(beforeRemoval, {
      kind: "events",
      events: replay.firstFrame.events.slice(2),
    }).state;
    expect(afterRemoval.cursor).toBe(3);
    expect(afterRemoval.sessions[sessionId]).toBeUndefined();
    expect(afterRemoval.runtime[sessionId]).toBeUndefined();
    expect(runtimeState.snapshot(sessionId).versions).toBeUndefined();
  });

  it("serves real SnapshotService Runtime state and never snapshots a late orphan", async () => {
    const journal = new EventJournal({
      epoch: "epoch-real-runtime-snapshot",
      capacity: 10,
      now: () => "2026-08-15T08:00:00.000Z",
    });
    const runtimeState = new SessionRuntimeState({ journal });
    app = await createApp({
      assetRoot: null,
      journal,
      runtimeState,
      allowedOrigins: new Set([allowedOrigin]),
      workspaceRepository: new FixtureWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
      sessionCatalog: new FixtureSessionCatalog(),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    journal.publish(
      {
        type: "session.upserted",
        payload: {
          id: sessionId,
          workspaceId,
          title: "Real snapshot runtime",
          cwd: "/repo",
          phase: "idle",
          awaitingUser: false,
          updatedAt: "2026-08-15T08:00:00.000Z",
        },
      },
      { sessionId },
    );
    runtimeState.merge(sessionId, {
      versions: { sdk: "real-snapshot-sdk" },
      rawEvents: [{ messageType: "fixture" }],
    });

    const beforeRemoval = await connect(
      address.replace("http:", "ws:") + "/ws",
    );
    expect(beforeRemoval.firstFrame).toMatchObject({
      kind: "snapshot",
      snapshot: {
        cursor: 2,
        sessions: [{ id: sessionId }],
        runtime: {
          [sessionId]: {
            versions: { sdk: "real-snapshot-sdk" },
            rawEvents: [{ messageType: "fixture" }],
          },
        },
      },
    });

    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );
    const cursorAfterRemoval = journal.cursor();
    runtimeState.merge(sessionId, {
      versions: { sdk: "late-orphan" },
      hooks: [{ event: "late-hook" }],
    });
    expect(journal.cursor()).toBe(cursorAfterRemoval);

    const afterRemoval = await connect(
      address.replace("http:", "ws:") + "/ws",
    );
    expect(afterRemoval.firstFrame).toMatchObject({
      kind: "snapshot",
      snapshot: {
        cursor: 3,
        sessions: [],
        runtime: {},
      },
    });
    const beforeClient = reduceServerFrame(
      createInitialState(),
      beforeRemoval.firstFrame,
    ).state;
    const afterClient = reduceServerFrame(
      beforeClient,
      afterRemoval.firstFrame,
    ).state;
    expect(afterClient.sessions[sessionId]).toBeUndefined();
    expect(afterClient.runtime[sessionId]).toBeUndefined();
  });

  it("closes the app-owned Runtime journal listener on shutdown", async () => {
    const journal = new EventJournal({
      epoch: "epoch-runtime-app-close",
      capacity: 10,
    });
    const runtimeState = new SessionRuntimeState({ journal });
    app = await createApp({
      assetRoot: null,
      journal,
      runtimeState,
      allowedOrigins: new Set([allowedOrigin]),
      workspaceRepository: new FixtureWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
      sessionCatalog: new FixtureSessionCatalog(),
    });
    runtimeState.merge(sessionId, {
      versions: { sdk: "retained-after-app-close" },
    });

    await app.close();
    app = undefined;
    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );

    expect(runtimeState.snapshot(sessionId).versions).toEqual({
      sdk: "retained-after-app-close",
    });
  });

  it("replaces stale epochs with a snapshot", async () => {
    const journal = new EventJournal({ epoch: "epoch-new", capacity: 10 });
    app = await createApp({
      assetRoot: null,
      journal,
      allowedOrigins: new Set([allowedOrigin]),
      getSnapshot: () => ({
        serverEpoch: journal.epoch,
        cursor: journal.cursor(),
        workspaces: [],
        sessions: [],
        messages: {},
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        checkpointPreviews: [],
        runtime: {},
      }),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });

    const connection = await connect(
      address.replace("http:", "ws:") + "/ws?epoch=epoch-old&after=0",
    );

    expect(connection.firstFrame).toMatchObject({
      kind: "snapshot",
      snapshot: { serverEpoch: "epoch-new" },
    });
  });

  it("rejects WebSocket upgrades from an untrusted browser Origin", async () => {
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 10 });
    app = await createApp({
      assetRoot: null,
      journal,
      allowedOrigins: new Set([allowedOrigin]),
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const socket = new WebSocket(address.replace("http:", "ws:") + "/ws", {
      headers: { Origin: "https://example.com" },
    });
    sockets.push(socket);

    const statusCode = await new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once("open", () => reject(new Error("Untrusted socket opened")));
      socket.once("error", () => undefined);
    });

    expect(statusCode).toBe(403);
  });
});
