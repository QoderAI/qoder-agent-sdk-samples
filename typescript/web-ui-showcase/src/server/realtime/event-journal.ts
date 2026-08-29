import type { AppEvent, EventEnvelope } from "../../shared/events.js";
import { eventEnvelopeSchema } from "../../shared/events.js";

export type ReplayRequest = {
  epoch: string;
  after: number;
};

export type ReplayResult =
  | { kind: "events"; events: EventEnvelope[] }
  | { kind: "snapshot-required" };

export type EventJournalOptions = {
  epoch: string;
  capacity: number;
  now?: () => string;
};

export class EventJournal {
  readonly epoch: string;

  readonly #capacity: number;
  readonly #now: () => string;
  readonly #listeners = new Set<(event: EventEnvelope) => void>();
  #events: EventEnvelope[] = [];
  #nextSequence = 1;

  constructor(options: EventJournalOptions) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1) {
      throw new RangeError("Event journal capacity must be a positive integer");
    }
    this.epoch = options.epoch;
    this.#capacity = options.capacity;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  publish(
    event: AppEvent,
    correlation: { sessionId?: string; commandId?: string } = {},
  ): EventEnvelope {
    const envelope = eventEnvelopeSchema.parse({
      serverEpoch: this.epoch,
      sequence: this.#nextSequence,
      occurredAt: this.#now(),
      ...(correlation.sessionId === undefined
        ? {}
        : { sessionId: correlation.sessionId }),
      ...(correlation.commandId === undefined
        ? {}
        : { commandId: correlation.commandId }),
      ...event,
    });
    this.#nextSequence += 1;
    this.#events.push(envelope);
    if (this.#events.length > this.#capacity) {
      this.#events = this.#events.slice(-this.#capacity);
    }
    for (const listener of this.#listeners) {
      listener(envelope);
    }
    return envelope;
  }

  replay(request: ReplayRequest): ReplayResult {
    if (request.epoch !== this.epoch) {
      return { kind: "snapshot-required" };
    }
    const cursor = this.cursor();
    const oldestSequence = this.#events[0]?.sequence ?? cursor + 1;
    if (
      !Number.isInteger(request.after) ||
      request.after < 0 ||
      request.after > cursor ||
      request.after < oldestSequence - 1
    ) {
      return { kind: "snapshot-required" };
    }
    return {
      kind: "events",
      events: this.#events.filter((event) => event.sequence > request.after),
    };
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
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

  cursor(): number {
    return this.#nextSequence - 1;
  }
}
