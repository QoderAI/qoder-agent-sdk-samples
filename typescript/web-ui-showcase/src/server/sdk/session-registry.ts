import { AppError } from "../errors/app-error.js";
import type { SessionController } from "./session-controller.js";

export class SessionRegistry {
  readonly #controllers = new Map<string, SessionController>();
  readonly #operationTails = new Map<string, Promise<void>>();
  readonly #guardedOperations = new Map<string, Set<Promise<void>>>();
  readonly #reservationPermits = new Map<string, number>();
  #closing = false;
  #closeAllPromise: Promise<void> | undefined;

  runExclusive<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#closing) {
      throw new AppError({
        code: "SERVER_SHUTTING_DOWN",
        message: "本地服务正在关闭，无法再执行 Session 操作。",
        status: 503,
        retryable: true,
      });
    }
    return this.#enqueueExclusive(sessionId, async () => {
      await this.#waitForGuardedOperations(sessionId);
      this.#reservationPermits.set(
        sessionId,
        (this.#reservationPermits.get(sessionId) ?? 0) + 1,
      );
      try {
        return await operation();
      } finally {
        const remaining = (this.#reservationPermits.get(sessionId) ?? 1) - 1;
        if (remaining === 0) {
          this.#reservationPermits.delete(sessionId);
        } else {
          this.#reservationPermits.set(sessionId, remaining);
        }
      }
    });
  }

  /**
   * Runs one SDK command concurrently with peer commands while making later
   * lifecycle operations wait for its terminal state.
   */
  runGuarded<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#closing) {
      throw new AppError({
        code: "SERVER_SHUTTING_DOWN",
        message: "本地服务正在关闭，无法再执行 Session 操作。",
        status: 503,
        retryable: true,
      });
    }
    let finish: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const registered = this.#enqueueExclusive(sessionId, async () => {
      const operations = this.#guardedOperations.get(sessionId) ?? new Set();
      operations.add(completed);
      this.#guardedOperations.set(sessionId, operations);
    });
    return registered
      .then(operation)
      .finally(() => {
        finish?.();
        const operations = this.#guardedOperations.get(sessionId);
        operations?.delete(completed);
        if (operations?.size === 0) this.#guardedOperations.delete(sessionId);
      });
  }

  async #waitForGuardedOperations(sessionId: string): Promise<void> {
    const operations = this.#guardedOperations.get(sessionId);
    if (operations === undefined || operations.size === 0) return;
    await Promise.all([...operations]);
  }

  #enqueueExclusive<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#operationTails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#operationTails.set(sessionId, tail);
    void tail.finally(() => {
      if (this.#operationTails.get(sessionId) === tail) {
        this.#operationTails.delete(sessionId);
      }
    });
    return result;
  }

  reserve(sessionId: string, controller: SessionController): () => void {
    if (
      this.#closing &&
      (this.#reservationPermits.get(sessionId) ?? 0) === 0
    ) {
      throw new AppError({
        code: "SERVER_SHUTTING_DOWN",
        message: "本地服务正在关闭，无法创建新的 SDK Query。",
        status: 503,
        retryable: true,
      });
    }
    if (this.#controllers.has(sessionId)) {
      throw new AppError({
        code: "SESSION_ALREADY_LIVE",
        message: "This Session already has a live SDK Query.",
        status: 409,
        retryable: false,
      });
    }
    this.#controllers.set(sessionId, controller);
    let reserved = true;
    return () => {
      if (!reserved) {
        return;
      }
      reserved = false;
      if (this.#controllers.get(sessionId) === controller) {
        this.#controllers.delete(sessionId);
      }
    };
  }

  get(sessionId: string): SessionController | undefined {
    return this.#controllers.get(sessionId);
  }

  list(): SessionController[] {
    return [...this.#controllers.values()];
  }

  closeAll(reason: string): Promise<void> {
    this.#closing = true;
    this.#closeAllPromise ??= this.#closeEverySession(reason);
    return this.#closeAllPromise;
  }

  async #closeEverySession(reason: string): Promise<void> {
    const sessionIds = new Set([
      ...this.#operationTails.keys(),
      ...this.#controllers.keys(),
      ...this.#guardedOperations.keys(),
    ]);
    const results = await Promise.allSettled(
      [...sessionIds].map((sessionId) =>
        this.#enqueueExclusive(sessionId, async () => {
          await this.#waitForGuardedOperations(sessionId);
          const controller = this.#controllers.get(sessionId);
          if (controller === undefined) return;
          await controller.close(reason);
          if (this.#controllers.get(sessionId) === controller) {
            this.#controllers.delete(sessionId);
          }
        })),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more Sessions failed to close");
    }
  }
}
