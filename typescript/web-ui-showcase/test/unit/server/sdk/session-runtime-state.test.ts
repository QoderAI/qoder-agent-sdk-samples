import { describe, expect, it } from "vitest";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import { SessionRuntimeState } from "../../../../src/server/sdk/session-runtime-state.js";

const sessionId = "00000000-0000-4000-8000-000000000902";
const maxEntryBytes = 16_384;

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

describe("Session runtime diagnostics", () => {
  it("redacts and byte-bounds oversized Raw Events and runtime errors at the state owner", () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-state", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });
    const secret = "state-owner-secret";

    runtimeState.merge(sessionId, {
      rawEvents: [
        {
          event: "oversized.raw",
          payload: {
            privateKey: secret,
            unicode: "界".repeat(maxEntryBytes),
          },
        },
      ],
      errors: [
        {
          code: "SDK_RUNTIME_FAILURE",
          message: "界".repeat(maxEntryBytes),
          retryable: false,
          details: {
            clientSecret: secret,
            response: "狐".repeat(maxEntryBytes),
          },
        },
      ],
    });

    const snapshot = runtimeState.snapshot(sessionId);
    const raw = snapshot.rawEvents[0];
    const error = snapshot.errors[0];
    expect(raw).toMatchObject({
      __qoderDiagnostic: {
        kind: "truncated",
        maxBytes: maxEntryBytes,
        originalBytes: expect.any(Number),
      },
    });
    expect(error).toMatchObject({
      details: {
        __qoderDiagnostic: {
          kind: "truncated",
          maxBytes: maxEntryBytes,
          originalBytes: expect.any(Number),
        },
      },
    });
    expect(serializedBytes(raw)).toBeLessThanOrEqual(maxEntryBytes);
    expect(serializedBytes(error)).toBeLessThanOrEqual(maxEntryBytes);
    expect(JSON.stringify([raw, error])).not.toContain(secret);
    expect(JSON.stringify([raw, error])).toContain("[REDACTED]");
  });

  it("retains only the newest bounded entries in each diagnostic timeline", () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-limit", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal, timelineLimit: 2 });

    runtimeState.merge(sessionId, {
      hooks: [{ index: 1 }, { index: 2 }, { index: 3 }],
      rawEvents: [{ index: 1 }, { index: 2 }, { index: 3 }],
      errors: [1, 2, 3].map((index) => ({
        code: `ERROR_${index}`,
        message: `Failure ${index}`,
        retryable: false,
      })),
    });

    expect(runtimeState.snapshot(sessionId)).toMatchObject({
      hooks: [{ index: 2 }, { index: 3 }],
      rawEvents: [{ index: 2 }, { index: 3 }],
      errors: [{ code: "ERROR_2" }, { code: "ERROR_3" }],
    });
  });

  it("merges independently reported SDK and CLI versions", () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-versions", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });

    runtimeState.merge(sessionId, { versions: { sdk: "1.0.21" } });
    runtimeState.merge(sessionId, { versions: { cli: "1.1.20" } });

    expect(runtimeState.snapshot(sessionId).versions).toEqual({
      sdk: "1.0.21",
      cli: "1.1.20",
    });
  });

  it("treats Session removal as terminal for every late diagnostic merge", () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-terminal", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, { versions: { sdk: "before-removal" } });
    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );
    const cursorAfterRemoval = journal.cursor();

    const late = runtimeState.merge(sessionId, {
      context: { percentage: 90 },
      hooks: [{ event: "late-hook" }],
      rawEvents: [{ event: "late-raw" }],
      errors: [{
        code: "LATE_ERROR",
        message: "Late diagnostic",
        retryable: false,
      }],
    });
    const lateCapability = runtimeState.replaceCapabilityErrors(sessionId, {
      models: [{ id: "late-model" }],
      errors: [{
        code: "SDK_CAPABILITY_UNAVAILABLE",
        message: "Late capability refresh",
        retryable: false,
        details: {
          provenance: "runtime-refresh",
          capability: "models",
        },
      }],
    });

    expect(late).toMatchObject({
      sessionId,
      hooks: [],
      rawEvents: [],
      errors: [],
    });
    expect(late).not.toHaveProperty("context");
    expect(lateCapability).not.toHaveProperty("models");
    expect(runtimeState.snapshot(sessionId)).not.toHaveProperty("versions");
    expect(journal.cursor()).toBe(cursorAfterRemoval);
    expect(journal.replay({
      epoch: "epoch-runtime-terminal",
      after: cursorAfterRemoval,
    })).toEqual({ kind: "events", events: [] });
  });

  it("discards only an unpublished rollback tombstone", () => {
    const journal = new EventJournal({
      epoch: "epoch-runtime-rollback",
      capacity: 100,
    });
    const runtimeState = new SessionRuntimeState({ journal });
    const rollbackId = "00000000-0000-4000-8000-000000000903";
    const deletedId = "00000000-0000-4000-8000-000000000904";
    for (const id of [rollbackId, deletedId]) {
      runtimeState.merge(id, { skills: ["before-removal"] });
      journal.publish(
        { type: "session.removed", payload: { sessionId: id } },
        { sessionId: id },
      );
    }

    runtimeState.discardUnpublishedSession(rollbackId);

    expect(runtimeState.merge(rollbackId, {
      skills: ["after-rollback"],
    }).skills).toEqual(["after-rollback"]);
    expect(runtimeState.merge(deletedId, {
      skills: ["late-deletion"],
    }).skills).toBeUndefined();
  });

  it("stops observing removal events after an idempotent close", () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-close", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, { versions: { sdk: "retained-after-close" } });

    runtimeState.close();
    runtimeState.close();
    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );

    expect(runtimeState.snapshot(sessionId).versions).toEqual({
      sdk: "retained-after-close",
    });
  });
});
