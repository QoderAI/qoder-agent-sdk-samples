import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "../../../src/client/store/app-store.js";
import {
  RealtimeClient,
  type BrowserSocket,
} from "../../../src/client/transport/realtime-client.js";

class FakeSocket implements BrowserSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly close = vi.fn(() => this.onclose?.());

  open(): void {
    this.onopen?.();
  }
  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

class DeferredCloseSocket implements BrowserSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly close = vi.fn();

  message(data: string): void {
    this.onmessage?.({ data });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RealtimeClient", () => {
  it("drops a removed selected Session from later reconnect URLs", () => {
    vi.useFakeTimers();
    const store = new AppStore();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const sessionId = "00000000-0000-4000-8000-000000000e31";
    const workspaceId = "00000000-0000-4000-8000-000000000e32";
    const client = new RealtimeClient({
      store,
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.start();
    client.selectSession(sessionId);
    vi.advanceTimersByTime(250);
    expect(urls.at(-1)).toContain(`sessionId=${sessionId}`);
    sockets.at(-1)?.message({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "epoch-selected",
        cursor: 1,
        workspaces: [{
          id: workspaceId,
          displayName: "project",
          path: "/repo",
          createdAt: "2026-08-15T08:00:00.000Z",
          updatedAt: "2026-08-15T08:00:00.000Z",
        }],
        sessions: [{
          id: sessionId,
          workspaceId,
          title: "Selected",
          cwd: "/repo",
          phase: "idle",
          awaitingUser: false,
          createdAt: "2026-08-15T08:00:00.000Z",
          updatedAt: "2026-08-15T08:00:00.000Z",
        }],
        messages: { [sessionId]: [] },
        queuedInputs: [],
        interactions: [],
        tasks: [],
        mcpServers: [],
        checkpointPreviews: [],
        runtime: {},
      },
    });
    sockets.at(-1)?.message({
      kind: "events",
      events: [{
        serverEpoch: "epoch-selected",
        sequence: 2,
        occurredAt: "2026-08-15T08:01:00.000Z",
        type: "session.removed",
        payload: { sessionId },
        sessionId,
      }],
    });
    expect(store.getState().selectedSessionId).toBeNull();

    sockets.at(-1)?.close();
    vi.advanceTimersByTime(250);
    expect(urls.at(-1)).toBe(
      "ws://127.0.0.1:8787/ws?epoch=epoch-selected&after=2",
    );
    client.stop();
  });

  it("reconnects with the last cursor and resets backoff after a snapshot", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const client = new RealtimeClient({
      store: new AppStore(),
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });

    client.start();
    expect(urls).toEqual(["ws://127.0.0.1:8787/ws"]);
    sockets[0]?.open();
    sockets[0]?.message({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "epoch-a",
        cursor: 7,
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
    });
    sockets[0]?.close();
    vi.advanceTimersByTime(249);
    expect(urls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(urls[1]).toBe(
      "ws://127.0.0.1:8787/ws?epoch=epoch-a&after=7",
    );
    client.stop();
  });

  it("closes malformed streams and reports a safe protocol error", () => {
    const socket = new FakeSocket();
    const onProtocolError = vi.fn();
    const client = new RealtimeClient({
      store: new AppStore(),
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: () => socket,
      onProtocolError,
    });
    client.start();
    socket.onmessage?.({ data: "not-json" });

    expect(onProtocolError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "PROTOCOL_ERROR" }),
    );
    expect(socket.close).toHaveBeenCalled();
    client.stop();
  });

  it("invalidates a malformed socket once before its delayed close event", () => {
    vi.useFakeTimers();
    const sockets: DeferredCloseSocket[] = [];
    const onProtocolError = vi.fn();
    const client = new RealtimeClient({
      store: new AppStore(),
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: () => {
        const socket = new DeferredCloseSocket();
        sockets.push(socket);
        return socket;
      },
      onProtocolError,
    });
    client.start();

    sockets[0]?.message("not-json");
    sockets[0]?.message("still-not-json");

    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(249);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it("forces snapshots after gaps and clears protocol errors on valid recovery", () => {
    vi.useFakeTimers();
    const store = new AppStore();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const client = new RealtimeClient({
      store,
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.start();
    sockets[0]?.message({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "epoch-a",
        cursor: 7,
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
    });
    sockets[0]?.message({
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 9,
        occurredAt: "2026-08-15T08:00:00.000Z",
        type: "workspace.removed",
        payload: {
          workspaceId: "00000000-0000-4000-8000-000000000e21",
        },
      }],
    });
    vi.advanceTimersByTime(250);
    expect(urls[1]).toBe("ws://127.0.0.1:8787/ws");

    sockets[1]?.onmessage?.({ data: "not-json" });
    expect(store.getState().protocolError?.code).toBe("PROTOCOL_ERROR");
    vi.advanceTimersByTime(500);
    expect(urls[2]).toBe("ws://127.0.0.1:8787/ws");
    sockets[2]?.message({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "epoch-b",
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
    });
    expect(store.getState().protocolError).toBeNull();
    client.stop();
  });

  it("backs off reconnects from 250ms and caps them at 5000ms", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = new RealtimeClient({
      store: new AppStore(),
      baseUrl: "http://127.0.0.1:8787",
      websocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.start();

    for (const [index, delay] of [250, 500, 1_000, 2_000, 4_000, 5_000, 5_000].entries()) {
      sockets[index]?.close();
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(index + 1);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(index + 2);
    }
    client.stop();
  });
});
