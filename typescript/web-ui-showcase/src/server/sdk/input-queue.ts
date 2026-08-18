import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@qoder-ai/qoder-agent-sdk";
import type { InputPriority } from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";

export type EnqueueInput = {
  text: string;
  priority: InputPriority;
  shouldQuery: boolean;
};

export type QueuedInput = EnqueueInput & {
  uuid: string;
  state: "buffered" | "delivered";
};

type StateChange = QueuedInput | { uuid: string; removed: true };

type Waiter = {
  resolve: (result: IteratorResult<SDKUserMessage>) => void;
  reject: (error: unknown) => void;
};

function copyItem(item: QueuedInput): QueuedInput {
  return { ...item };
}

export class InputQueue implements AsyncIterable<SDKUserMessage> {
  readonly #createUuid: () => string;
  readonly #onStateChange: (change: StateChange) => void;
  readonly #listeners = new Set<(change: StateChange) => void>();
  readonly #items: QueuedInput[] = [];
  readonly #usedUuids = new Set<string>();
  #waiter: Waiter | undefined;
  #closed = false;
  #closeError: Error | undefined;

  constructor(options: {
    createUuid?: () => string;
    onStateChange?: (change: StateChange) => void;
  } = {}) {
    this.#createUuid = options.createUuid ?? randomUUID;
    this.#onStateChange = options.onStateChange ?? (() => undefined);
    this.#listeners.add(this.#onStateChange);
  }

  enqueue(input: EnqueueInput): QueuedInput {
    if (this.#closed) {
      throw new AppError({
        code: "SESSION_CLOSED",
        message: "此 Session 当前不可用。请重新选择该 Session 后重试发送。",
        status: 409,
        retryable: true,
      });
    }
    const uuid = this.#createUuid();
    if (this.#usedUuids.has(uuid)) {
      throw new AppError({
        code: "INPUT_UUID_REUSED",
        message: "The input queue generated a duplicate message identifier.",
        status: 500,
        retryable: false,
      });
    }
    this.#usedUuids.add(uuid);
    const item: QueuedInput = {
      ...input,
      uuid,
      state: "buffered",
    };
    this.#items.push(item);
    this.#notify(copyItem(item));
    this.#deliverToWaiter();
    return copyItem(item);
  }

  cancelBuffered(uuid: string): boolean {
    const index = this.#items.findIndex(
      (item) => item.uuid === uuid && item.state === "buffered",
    );
    if (index === -1) {
      return false;
    }
    this.#items.splice(index, 1);
    this.#notify({ uuid, removed: true });
    return true;
  }

  acknowledgeDelivered(uuid: string): boolean {
    const index = this.#items.findIndex(
      (item) => item.uuid === uuid && item.state === "delivered",
    );
    if (index === -1) {
      return false;
    }
    this.#items.splice(index, 1);
    this.#notify({ uuid, removed: true });
    return true;
  }

  subscribe(listener: (change: StateChange) => void): () => void {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  list(): QueuedInput[] {
    return this.#items.map(copyItem);
  }

  close(error?: Error): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#closeError = error;
    const waiter = this.#waiter;
    this.#waiter = undefined;
    if (waiter === undefined) {
      return;
    }
    if (error === undefined) {
      waiter.resolve({ done: true, value: undefined });
    } else {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => this.#next(),
    };
  }

  #next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.#waiter !== undefined) {
      return Promise.reject(
        new AppError({
          code: "INPUT_QUEUE_CONCURRENT_WAIT",
          message: "Only one SDK input consumer may wait on a Session.",
          status: 500,
          retryable: false,
        }),
      );
    }
    const buffered = this.#items.find((item) => item.state === "buffered");
    if (buffered !== undefined) {
      return Promise.resolve({
        done: false,
        value: this.#deliver(buffered),
      });
    }
    if (this.#closed) {
      return this.#closeError === undefined
        ? Promise.resolve({ done: true, value: undefined })
        : Promise.reject(this.#closeError);
    }
    return new Promise((resolve, reject) => {
      this.#waiter = { resolve, reject };
    });
  }

  #deliverToWaiter(): void {
    const waiter = this.#waiter;
    if (waiter === undefined) {
      return;
    }
    const buffered = this.#items.find((item) => item.state === "buffered");
    if (buffered === undefined) {
      return;
    }
    this.#waiter = undefined;
    waiter.resolve({ done: false, value: this.#deliver(buffered) });
  }

  #deliver(item: QueuedInput): SDKUserMessage {
    item.state = "delivered";
    this.#notify(copyItem(item));
    return {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: item.text }],
      },
      parent_tool_use_id: null,
      priority: item.priority,
      shouldQuery: item.shouldQuery,
      uuid: item.uuid,
    };
  }

  #notify(change: StateChange): void {
    for (const listener of this.#listeners) {
      listener(change);
    }
  }
}
