import { describe, expect, it } from "vitest";
import { AppStore } from "../../../src/client/store/app-store.js";
import { findCommandFailure } from "../../../src/client/store/command-ownership.js";

const sessionId = "00000000-0000-4000-8000-000000000901";
const modelCommandId = "00000000-0000-4000-8000-000000000902";
const permissionCommandId = "00000000-0000-4000-8000-000000000903";

describe("command ownership", () => {
  it("keeps multiple accepted controls until the matching failure is dismissed", () => {
    const store = new AppStore();
    const snapshot = {
      serverEpoch: "ownership",
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
    };
    store.applyFrame({ kind: "snapshot", snapshot });
    store.registerCommand(modelCommandId, {
      surface: "runtime",
      control: "model",
      sessionId,
    });
    store.registerCommand(permissionCommandId, {
      surface: "runtime",
      control: "permission",
      sessionId,
    });
    store.applyFrame({
      kind: "events",
      events: [{
        serverEpoch: "ownership",
        sequence: 1,
        occurredAt: "2026-08-15T08:00:01.000Z",
        commandId: modelCommandId,
        sessionId,
        type: "command.failed",
        payload: {
          error: {
            code: "MODEL_SELECTION_FAILED",
            message: "无法应用所选 Model。",
            retryable: true,
          },
        },
      }],
    });

    expect(findCommandFailure(store.getState(), {
      surface: "runtime",
      control: "model",
      sessionId,
    })?.commandId).toBe(modelCommandId);
    expect(store.getState().commandOwnerships).toHaveLength(2);

    store.dismissCommandFailure(modelCommandId);

    expect(findCommandFailure(store.getState(), {
      surface: "runtime",
      control: "model",
      sessionId,
    })).toBeUndefined();
    expect(store.getState().commandOwnerships).toEqual([
      expect.objectContaining({ commandId: permissionCommandId }),
    ]);
  });

  it("dismisses only the global protocol notice", () => {
    const store = new AppStore();
    store.registerCommand(modelCommandId, {
      surface: "runtime",
      control: "model",
      sessionId,
    });
    store.setProtocolError({
      code: "PROTOCOL_ERROR",
      message: "实时事件流中断。",
      retryable: true,
    });

    store.dismissProtocolError();

    expect(store.getState().protocolError).toBeNull();
    expect(store.getState().commandOwnerships).toHaveLength(1);
  });

  it("bounds unresolved ownership without replacing commands from one control", () => {
    const store = new AppStore();
    for (let index = 0; index < 55; index += 1) {
      store.registerCommand(`command-${index}`, {
        surface: "runtime",
        control: "model",
        sessionId,
      });
    }

    expect(store.getState().commandOwnerships).toHaveLength(50);
    expect(store.getState().commandOwnerships[0]?.commandId).toBe("command-5");
    expect(store.getState().commandOwnerships.at(-1)?.commandId).toBe(
      "command-54",
    );
  });

  it("reveals an older same-control failure after dismissing the newest", () => {
    const store = new AppStore();
    const olderCommandId = "00000000-0000-4000-8000-000000000904";
    const newerCommandId = "00000000-0000-4000-8000-000000000905";
    const owner = {
      surface: "runtime" as const,
      control: "model" as const,
      sessionId,
    };
    store.applyFrame({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "same-control",
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
    store.registerCommand(olderCommandId, owner);
    store.registerCommand(newerCommandId, owner);
    store.applyFrame({
      kind: "events",
      events: [olderCommandId, newerCommandId].map((candidate, index) => ({
        serverEpoch: "same-control",
        sequence: index + 1,
        occurredAt: `2026-08-15T08:00:0${index + 1}.000Z`,
        commandId: candidate,
        sessionId,
        type: "command.failed" as const,
        payload: {
          error: {
            code: "MODEL_SELECTION_FAILED",
            message: `Model failure ${index + 1}`,
            retryable: true,
          },
        },
      })),
    });

    expect(findCommandFailure(store.getState(), owner)?.commandId).toBe(
      newerCommandId,
    );

    store.dismissCommandFailure(newerCommandId);

    expect(findCommandFailure(store.getState(), owner)?.commandId).toBe(
      olderCommandId,
    );
  });

  it("correlates a failure that arrives before HTTP acceptance registers its owner", () => {
    const store = new AppStore();
    store.applyFrame({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "early-failure",
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
    store.applyFrame({
      kind: "events",
      events: [{
        serverEpoch: "early-failure",
        sequence: 1,
        occurredAt: "2026-08-15T08:00:01.000Z",
        commandId: modelCommandId,
        sessionId,
        type: "command.failed",
        payload: {
          error: {
            code: "MODEL_SELECTION_FAILED",
            message: "无法应用所选 Model。",
            retryable: true,
          },
        },
      }],
    });
    const owner = {
      surface: "runtime" as const,
      control: "model" as const,
      sessionId,
    };

    expect(findCommandFailure(store.getState(), owner)).toBeUndefined();

    store.applyFrame({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "after-early-failure",
        cursor: 1,
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

    store.registerCommand(modelCommandId, owner);

    expect(findCommandFailure(store.getState(), owner)?.commandId).toBe(
      modelCommandId,
    );
  });

  it("retains bounded ownership across a reconnect snapshot", () => {
    const store = new AppStore();
    store.applyFrame({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "before-reconnect",
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
    store.registerCommand(modelCommandId, {
      surface: "runtime",
      control: "model",
      sessionId,
    });
    store.applyFrame({
      kind: "events",
      events: [{
        serverEpoch: "before-reconnect",
        sequence: 1,
        occurredAt: "2026-08-15T08:00:01.000Z",
        commandId: modelCommandId,
        sessionId,
        type: "command.failed",
        payload: {
          error: {
            code: "MODEL_SELECTION_FAILED",
            message: "无法应用所选 Model。",
            retryable: true,
          },
        },
      }],
    });

    store.applyFrame({
      kind: "snapshot",
      snapshot: {
        serverEpoch: "reconnected",
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

    expect(store.getState().commandOwnerships).toEqual([
      expect.objectContaining({ commandId: modelCommandId }),
    ]);
    expect(store.getState().commandFailures).toEqual([
      expect.objectContaining({ commandId: modelCommandId }),
    ]);
  });
});
