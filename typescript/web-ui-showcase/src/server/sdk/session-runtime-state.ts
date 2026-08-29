import {
  sessionRuntimeViewSchema,
  type SessionRuntimeView,
} from "../../shared/model.js";
import { runtimeRefreshCapability } from "../../shared/errors.js";
import type { EventJournal } from "../realtime/event-journal.js";
import {
  safeDiagnosticError,
  safeDiagnosticRecord,
} from "./redact.js";

export type SessionRuntimePatch = Partial<SessionRuntimeView>;

function emptyRuntime(sessionId: string): SessionRuntimeView {
  return {
    sessionId,
    currentModel: null,
    currentPermissionMode: "default",
    capabilities: [],
    hooks: [],
    rawEvents: [],
    errors: [],
  };
}

/** Merges all runtime, Hook, and message observations into one strict view. */
export class SessionRuntimeState {
  readonly #journal: EventJournal;
  readonly #views = new Map<string, SessionRuntimeView>();
  readonly #removed = new Set<string>();
  readonly #timelineLimit: number;
  #unsubscribe: (() => void) | undefined;

  constructor(options: { journal: EventJournal; timelineLimit?: number }) {
    this.#journal = options.journal;
    this.#timelineLimit = options.timelineLimit ?? 200;
    this.#unsubscribe = this.#journal.subscribe((event) => {
      if (event.type === "session.removed") {
        this.remove(event.payload.sessionId);
      }
    });
  }

  merge(sessionId: string, patch: SessionRuntimePatch): SessionRuntimeView {
    return this.#merge(sessionId, patch, false);
  }

  /** Replaces current capability-refresh errors while retaining other errors. */
  replaceCapabilityErrors(
    sessionId: string,
    patch: SessionRuntimePatch & { errors: SessionRuntimeView["errors"] },
  ): SessionRuntimeView {
    return this.#merge(sessionId, patch, true);
  }

  #merge(
    sessionId: string,
    patch: SessionRuntimePatch,
    replaceCapabilityErrors: boolean,
  ): SessionRuntimeView {
    if (this.#removed.has(sessionId)) return emptyRuntime(sessionId);
    const current = this.snapshot(sessionId);
    const {
      hooks,
      rawEvents,
      errors,
      versions,
      sessionId: _ignoredSessionId,
      ...values
    } = patch;
    const next = sessionRuntimeViewSchema.parse({
      ...current,
      ...values,
      ...(versions === undefined
        ? {}
        : { versions: { ...current.versions, ...versions } }),
      hooks:
        hooks === undefined
          ? current.hooks
          : [
              ...current.hooks,
              ...hooks.map((entry) => safeDiagnosticRecord(entry)),
            ].slice(-this.#timelineLimit),
      rawEvents:
        rawEvents === undefined
          ? current.rawEvents
          : [
              ...current.rawEvents,
              ...rawEvents.map((entry) => safeDiagnosticRecord(entry)),
            ].slice(-this.#timelineLimit),
      errors:
        errors === undefined
          ? current.errors
          : [
              ...(replaceCapabilityErrors
                ? current.errors.filter(
                    (error) => runtimeRefreshCapability(error) === undefined,
                  )
                : current.errors),
              ...errors.map((error) => safeDiagnosticError(error)),
            ].slice(-this.#timelineLimit),
      sessionId,
    });
    this.#views.set(sessionId, next);
    this.#journal.publish(
      {
        type: "runtime.updated",
        payload: { sessionId, runtime: next },
      },
      { sessionId },
    );
    return next;
  }

  snapshot(sessionId: string): SessionRuntimeView {
    return this.#views.get(sessionId) ?? emptyRuntime(sessionId);
  }

  remove(sessionId: string): void {
    this.#removed.add(sessionId);
    this.#views.delete(sessionId);
  }

  /** Clears rollback state for a Session that was never published successfully. */
  discardUnpublishedSession(sessionId: string): void {
    this.#views.delete(sessionId);
    this.#removed.delete(sessionId);
  }

  /** Stops observing journal removal events without changing retained views. */
  close(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }
}
