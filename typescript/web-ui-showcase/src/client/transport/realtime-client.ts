import { serverFrameSchema } from "../../shared/frames.js";
import type { WireError } from "../../shared/errors.js";
import type { AppStore } from "../store/app-store.js";

export interface BrowserSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
}

type TimerApi = {
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

const protocolError: WireError = {
  code: "PROTOCOL_ERROR",
  message: "实时服务返回了无法解析的数据，正在重新加载 Snapshot。",
  retryable: true,
};

/** Receives snapshots/events and reconnects with bounded cursor replay. */
export class RealtimeClient {
  readonly #store: AppStore;
  readonly #baseUrl: string;
  readonly #websocketFactory: (url: string) => BrowserSocket;
  readonly #onProtocolError: (error: WireError) => void;
  readonly #timers: TimerApi;
  #socket: BrowserSocket | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running = false;
  #reconnectDelay = 250;
  #forceSnapshot = false;
  #selectedSessionId: string | null = null;

  constructor(options: {
    store: AppStore;
    baseUrl?: string;
    websocketFactory?: (url: string) => BrowserSocket;
    onProtocolError?: (error: WireError) => void;
    timers?: TimerApi;
  }) {
    this.#store = options.store;
    this.#baseUrl = options.baseUrl ?? window.location.origin;
    this.#websocketFactory =
      options.websocketFactory ??
      ((url) => new WebSocket(url) as unknown as BrowserSocket);
    this.#onProtocolError = options.onProtocolError ?? (() => undefined);
    this.#timers = options.timers ?? {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer),
    };
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#connect();
  }

  stop(): void {
    this.#running = false;
    if (this.#timer !== undefined) {
      this.#timers.clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const socket = this.#socket;
    this.#socket = undefined;
    socket?.close();
    this.#store.setConnectionState("disconnected");
  }

  selectSession(sessionId: string | null): void {
    if (sessionId === this.#selectedSessionId) return;
    this.#selectedSessionId = sessionId;
    this.#store.selectSession(sessionId);
    this.#forceSnapshot = true;
    const socket = this.#socket;
    if (socket === undefined) this.#scheduleReconnect(0);
    else socket.close();
  }

  reloadSnapshot(): void {
    this.#forceSnapshot = true;
    this.#store.setProtocolError(null);
    const socket = this.#socket;
    if (socket === undefined) this.#scheduleReconnect(0);
    else socket.close();
  }

  #connect(): void {
    if (!this.#running || this.#socket !== undefined) return;
    this.#store.setConnectionState("connecting");
    const socket = this.#websocketFactory(this.#socketUrl());
    this.#socket = socket;
    socket.onopen = () => {
      if (socket === this.#socket) this.#store.setConnectionState("connected");
    };
    socket.onmessage = (event) => {
      if (socket !== this.#socket) return;
      try {
        const frame = serverFrameSchema.parse(JSON.parse(event.data));
        const reduced = this.#store.applyFrame(frame);
        this.#selectedSessionId = this.#store.getState().selectedSessionId;
        if (frame.kind === "snapshot") {
          this.#reconnectDelay = 250;
          this.#forceSnapshot = false;
          this.#store.setProtocolError(null);
        }
        if (reduced.needsSnapshot) {
          this.#recoverWithSnapshot(socket);
        }
      } catch {
        this.#recoverWithSnapshot(socket, protocolError);
      }
    };
    socket.onerror = () => {
      socket.close();
    };
    socket.onclose = () => {
      if (socket !== this.#socket) return;
      this.#socket = undefined;
      this.#store.setConnectionState("disconnected");
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect(delay = this.#reconnectDelay): void {
    if (!this.#running || this.#timer !== undefined) return;
    if (delay > 0) this.#reconnectDelay = Math.min(delay * 2, 5_000);
    this.#timer = this.#timers.setTimeout(() => {
      this.#timer = undefined;
      this.#connect();
    }, delay);
  }

  #recoverWithSnapshot(socket: BrowserSocket, error?: WireError): void {
    if (socket !== this.#socket) return;
    this.#socket = undefined;
    this.#forceSnapshot = true;
    if (error !== undefined) {
      this.#store.setProtocolError(error);
      this.#onProtocolError(error);
    }
    this.#store.setConnectionState("disconnected");
    socket.close();
    this.#scheduleReconnect();
  }

  #socketUrl(): string {
    const url = new URL("/ws", this.#baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (this.#selectedSessionId !== null) {
      url.searchParams.set("sessionId", this.#selectedSessionId);
    }
    const state = this.#store.getState();
    if (!this.#forceSnapshot && state.serverEpoch !== null) {
      url.searchParams.set("epoch", state.serverEpoch);
      url.searchParams.set("after", String(state.cursor));
    }
    return url.toString();
  }
}
