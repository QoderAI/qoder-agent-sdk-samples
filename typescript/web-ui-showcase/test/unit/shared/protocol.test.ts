import { describe, expect, it } from "vitest";
import { commandAcceptedSchema } from "../../../src/shared/commands.js";
import { wireErrorSchema } from "../../../src/shared/errors.js";
import { eventEnvelopeSchema } from "../../../src/shared/events.js";
import { serverFrameSchema } from "../../../src/shared/frames.js";
import { appSnapshotSchema } from "../../../src/shared/snapshots.js";

const sessionId = "00000000-0000-4000-8000-000000000001";
const commandId = "00000000-0000-4000-8000-000000000002";

describe("application protocol", () => {
  it("parses a snapshot frame with a cursor", () => {
    const parsed = serverFrameSchema.parse({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "epoch-1",
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

    expect(parsed.kind).toBe("snapshot");
  });

  it("parses Session runtime snapshots and rejects the removed Inspector field", () => {
    const snapshot = {
      serverEpoch: "epoch-1",
      cursor: 7,
      workspaces: [],
      sessions: [],
      messages: {},
      queuedInputs: [],
      interactions: [],
      tasks: [],
      mcpServers: [],
      checkpointPreviews: [],
      runtime: {
        [sessionId]: {
          sessionId,
          currentModel: "performance",
          currentPermissionMode: "default",
          capabilities: [],
          hooks: [],
          rawEvents: [],
          errors: [],
        },
      },
    };

    expect(appSnapshotSchema.parse(snapshot).runtime[sessionId]).toMatchObject({
      sessionId,
      hooks: [],
      rawEvents: [],
    });
    expect(appSnapshotSchema.safeParse({
      ...snapshot,
      runtime: undefined,
      inspector: snapshot.runtime,
    }).success).toBe(false);
  });

  it("parses runtime updates and rejects the removed Inspector event", () => {
    const envelope = {
      serverEpoch: "epoch-1",
      sequence: 8,
      sessionId,
      occurredAt: "2026-08-14T08:00:00.000Z",
      type: "runtime.updated",
      payload: {
        sessionId,
        runtime: {
          sessionId,
          currentModel: "performance",
          currentPermissionMode: "default",
          capabilities: [],
          hooks: [],
          rawEvents: [],
          errors: [],
        },
      },
    };

    expect(eventEnvelopeSchema.parse(envelope)).toMatchObject({
      type: "runtime.updated",
      payload: { sessionId },
    });
    expect(eventEnvelopeSchema.safeParse({
      ...envelope,
      type: "inspector.updated",
      payload: {
        sessionId,
        inspector: envelope.payload.runtime,
      },
    }).success).toBe(false);
  });

  it("keeps lifecycle events correlated to their command and session", () => {
    const parsed = eventEnvelopeSchema.parse({
      serverEpoch: "epoch-1",
      sequence: 8,
      sessionId,
      commandId,
      occurredAt: "2026-08-14T08:00:00.000Z",
      type: "session.lifecycle",
      payload: {
        sessionId,
        lifecycle: {
          phase: "running",
          awaitingUser: false,
        },
      },
    });

    expect(parsed).toMatchObject({
      sequence: 8,
      sessionId,
      commandId,
      type: "session.lifecycle",
    });
  });

  it("accepts only UUID command identifiers", () => {
    expect(commandAcceptedSchema.parse({ commandId })).toEqual({ commandId });
    expect(() => commandAcceptedSchema.parse({ commandId: "pending" })).toThrow();
  });

  it("rejects server-only error causes", () => {
    expect(() =>
      wireErrorSchema.parse({
        code: "SDK_FAILURE",
        message: "Query failed",
        retryable: true,
        cause: "secret stack",
      }),
    ).toThrow();
  });
});
