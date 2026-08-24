import { describe, expect, it } from "vitest";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";
import type { ServerFrame } from "../../../src/shared/frames.js";
import {
  createInitialState,
  reduceServerFrame,
} from "../../../src/client/store/app-reducer.js";

const workspaceId = "00000000-0000-4000-8000-000000000b01";
const sessionId = "00000000-0000-4000-8000-000000000b02";
const interactionId = "00000000-0000-4000-8000-000000000b03";
const commandId = "00000000-0000-4000-8000-000000000b04";
const checkpointPreviewId = "00000000-0000-4000-8000-000000000b07";
const otherCheckpointPreviewId = "00000000-0000-4000-8000-000000000b09";
const otherSessionId = "00000000-0000-4000-8000-000000000b08";

function snapshot(): AppSnapshot {
  return {
    serverEpoch: "epoch-a",
    cursor: 7,
    workspaces: [
      {
        id: workspaceId,
        displayName: "repo",
        path: "/repo",
        createdAt: "2026-08-14T08:00:00.000Z",
        updatedAt: "2026-08-14T08:00:00.000Z",
      },
    ],
    sessions: [
      {
        id: sessionId,
        workspaceId,
        title: "Inspect repository",
        cwd: "/repo",
        phase: "restorable",
        awaitingUser: false,
        updatedAt: "2026-08-14T08:00:00.000Z",
      },
    ],
    messages: {},
    queuedInputs: [],
    interactions: [],
    tasks: [],
    mcpServers: [],
    checkpointPreviews: [],
    runtime: {},
  };
}

describe("application reducer", () => {
  it("keeps command failure correlation from the event envelope", () => {
    const hydrated = reduceServerFrame(createInitialState(), {
      kind: "snapshot",
      snapshot: snapshot(),
    }).state;

    const reduced = reduceServerFrame(hydrated, {
      kind: "events",
      events: [
        {
          serverEpoch: "epoch-a",
          sequence: 8,
          occurredAt: "2026-08-14T08:01:00.000Z",
          commandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "SESSION_RESUME_FAILED",
              message: "Resume failed.",
              retryable: true,
            },
          },
        },
      ],
    }).state as unknown as {
      commandFailures: Array<{
        commandId?: string;
        sessionId?: string;
        error: { code: string; message: string; retryable: boolean };
      }>;
    };

    expect(reduced.commandFailures.at(-1)).toEqual({
      commandId,
      sessionId,
      error: {
        code: "SESSION_RESUME_FAILED",
        message: "Resume failed.",
        retryable: true,
      },
    });
  });

  it("replaces server state while preserving local navigation", () => {
    const initial = {
      ...createInitialState(),
      selectedSessionId: sessionId,
      sidebarWidth: 56,
      preferredDetailsWidth: 420,
      detailsSelection: {
        kind: "task" as const,
        sessionId,
        taskId: "00000000-0000-4000-8000-000000000b06",
      },
      sdkConsoleOpen: true,
      settingsOpen: true,
    };
    const result = reduceServerFrame(initial, {
      kind: "snapshot",
      snapshot: snapshot(),
    });

    expect(result.needsSnapshot).toBe(false);
    expect(result.state.workspaceIds).toEqual([workspaceId]);
    expect(result.state.sessionIds).toEqual([sessionId]);
    expect(result.state.selectedSessionId).toBe(sessionId);
    expect(result.state).toMatchObject({
      sidebarWidth: 56,
      preferredDetailsWidth: 420,
      detailsSelection: {
        kind: "task",
        sessionId,
        taskId: "00000000-0000-4000-8000-000000000b06",
      },
      sdkConsoleOpen: true,
      settingsOpen: true,
    });
  });

  it("applies only contiguous events and replaces conversation atomically", () => {
    const hydrated = reduceServerFrame(createInitialState(), {
      kind: "snapshot",
      snapshot: snapshot(),
    }).state;
    const replacement = {
      id: "00000000-0000-4000-8000-000000000b05",
      sessionId,
      kind: "user" as const,
      text: "Edited prompt",
      createdAt: "2026-08-14T08:01:00.000Z",
    };
    const frame: ServerFrame = {
      kind: "events",
      events: [
        {
          serverEpoch: "epoch-a",
          sequence: 8,
          occurredAt: "2026-08-14T08:01:00.000Z",
          sessionId,
          type: "conversation.replaced",
          payload: { sessionId, items: [replacement] },
        },
      ],
    };
    const reduced = reduceServerFrame(
      { ...hydrated, messages: { [sessionId]: [] } },
      frame,
    );
    expect(reduced.state.messages[sessionId]).toEqual([replacement]);
    expect(reduced.state.cursor).toBe(8);

    const gap = reduceServerFrame(reduced.state, {
      kind: "events",
      events: [{ ...frame.events[0]!, sequence: 10 }],
    });
    expect(gap.needsSnapshot).toBe(true);
    expect(gap.state).toBe(reduced.state);
  });

  it("projects Checkpoint snapshots, removals, completions, and conversation replacement", () => {
    const preview = {
      id: checkpointPreviewId,
      sessionId,
      userMessageId: "00000000-0000-4000-8000-000000000b05",
      scope: "files" as const,
      expiresAt: "2026-08-14T08:06:00.000Z",
      canRewind: true,
      status: "ready" as const,
      filesChanged: ["src/app.ts"],
      insertions: 4,
      deletions: 2,
      failedFiles: [],
    };
    const initialSnapshot = snapshot();
    initialSnapshot.checkpointPreviews = [preview];
    const hydrated = reduceServerFrame(createInitialState(), {
      kind: "snapshot",
      snapshot: initialSnapshot,
    }).state;

    expect(hydrated.checkpointPreviewIds).toEqual([checkpointPreviewId]);
    expect(hydrated.checkpointPreviews[checkpointPreviewId]).toEqual(preview);

    const removed = reduceServerFrame(hydrated, {
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 8,
        occurredAt: "2026-08-14T08:01:00.000Z",
        sessionId,
        type: "checkpoint.removed",
        payload: { sessionId, previewId: checkpointPreviewId },
      }],
    }).state;
    expect(removed.checkpointPreviewIds).toEqual([]);

    const previewed = reduceServerFrame(removed, {
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 9,
        occurredAt: "2026-08-14T08:01:01.000Z",
        sessionId,
        type: "checkpoint.previewed",
        payload: preview,
      }],
    }).state;
    const completed = reduceServerFrame(previewed, {
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 10,
        occurredAt: "2026-08-14T08:01:02.000Z",
        sessionId,
        type: "checkpoint.completed",
        payload: {
          sessionId,
          previewId: checkpointPreviewId,
          status: "partial",
          failedFiles: ["src/app.ts"],
        },
      }],
    }).state;
    expect(completed.checkpointPreviewIds).toEqual([]);
    expect(completed.checkpointPreviews[checkpointPreviewId]).toBeUndefined();
    expect(completed.checkpointCompletions[checkpointPreviewId]).toEqual({
      sessionId,
      previewId: checkpointPreviewId,
      status: "partial",
      failedFiles: ["src/app.ts"],
    });

    const secondPreview = { ...preview, id: otherCheckpointPreviewId };
    const previewedAgain = reduceServerFrame(completed, {
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 11,
        occurredAt: "2026-08-14T08:01:03.000Z",
        sessionId,
        type: "checkpoint.previewed",
        payload: secondPreview,
      }],
    }).state;
    const replaced = reduceServerFrame(previewedAgain, {
      kind: "events",
      events: [{
        serverEpoch: "epoch-a",
        sequence: 12,
        occurredAt: "2026-08-14T08:01:04.000Z",
        sessionId,
        type: "conversation.replaced",
        payload: { sessionId, items: [] },
      }],
    }).state;
    expect(replaced.checkpointPreviewIds).toEqual([]);
    expect(replaced.checkpointPreviews[otherCheckpointPreviewId]).toBeUndefined();
  });

  it("deduplicates opened interactions and removes resolved cards", () => {
    const hydrated = reduceServerFrame(createInitialState(), {
      kind: "snapshot",
      snapshot: snapshot(),
    }).state;
    const opened = {
      serverEpoch: "epoch-a",
      sequence: 8,
      occurredAt: "2026-08-14T08:01:00.000Z",
      sessionId,
      type: "interaction.opened" as const,
      payload: {
        id: interactionId,
        sessionId,
        kind: "tool-approval" as const,
        toolName: "Bash",
        input: { command: "pwd" },
        permissionSuggestions: [],
        openedAt: "2026-08-14T08:01:00.000Z",
        status: "pending" as const,
      },
    };
    const first = reduceServerFrame(hydrated, {
      kind: "events",
      events: [opened],
    }).state;
    const duplicate = reduceServerFrame(first, {
      kind: "events",
      events: [opened],
    }).state;
    expect(duplicate.interactionIds).toEqual([interactionId]);

    const resolved = reduceServerFrame(duplicate, {
      kind: "events",
      events: [
        {
          ...opened,
          sequence: 9,
          type: "interaction.resolved",
          payload: {
            interactionId,
            status: "resolved",
            resolvedAt: "2026-08-14T08:02:00.000Z",
          },
        },
      ],
    }).state;
    expect(resolved.interactionIds).toEqual([]);
  });

  it.each([
    { selected: true, expectedSelected: null, expectedSettingsOpen: false },
    { selected: false, expectedSelected: otherSessionId, expectedSettingsOpen: true },
  ] as const)(
    "purges every normalized Session-owned projection when removed (selected=$selected)",
    ({ selected, expectedSelected, expectedSettingsOpen }) => {
      const targetTask = `${sessionId}:task-target`;
      const otherTask = `${otherSessionId}:task-other`;
      const targetMcp = `${sessionId}:mcp-target`;
      const otherMcp = `${otherSessionId}:mcp-other`;
      const targetInteraction = "00000000-0000-4000-8000-000000000b11";
      const otherInteraction = "00000000-0000-4000-8000-000000000b12";
      const targetInput = "00000000-0000-4000-8000-000000000b13";
      const otherInput = "00000000-0000-4000-8000-000000000b14";
      const otherCommand = "00000000-0000-4000-8000-000000000b15";
      const workspaceCommand = "00000000-0000-4000-8000-000000000b16";
      const base = reduceServerFrame(createInitialState(), {
        kind: "snapshot",
        snapshot: snapshot(),
      }).state;
      const state = {
        ...base,
        selectedSessionId: selected ? sessionId : otherSessionId,
        settingsOpen: true,
        detailsSelection: {
          kind: "task" as const,
          sessionId,
          taskId: "task-target",
        },
        sessionIds: [sessionId, otherSessionId],
        sessions: {
          ...base.sessions,
          [otherSessionId]: {
            ...base.sessions[sessionId]!,
            id: otherSessionId,
            title: "Other Session",
          },
        },
        messages: { [sessionId]: [], [otherSessionId]: [] },
        queuedInputIds: [targetInput, otherInput],
        queuedInputs: {
          [targetInput]: {
            sessionId,
            uuid: targetInput,
            priority: "next" as const,
            shouldQuery: true,
            textPreview: "target",
            state: "buffered" as const,
          },
          [otherInput]: {
            sessionId: otherSessionId,
            uuid: otherInput,
            priority: "later" as const,
            shouldQuery: false,
            textPreview: "other",
            state: "delivered" as const,
          },
        },
        interactionIds: [targetInteraction, otherInteraction],
        interactions: {
          [targetInteraction]: {
            id: targetInteraction,
            sessionId,
            kind: "tool-approval" as const,
            toolName: "Bash",
            input: {},
            permissionSuggestions: [],
            openedAt: "2026-08-14T08:00:00.000Z",
            status: "pending" as const,
          },
          [otherInteraction]: {
            id: otherInteraction,
            sessionId: otherSessionId,
            kind: "tool-approval" as const,
            toolName: "Read",
            input: {},
            permissionSuggestions: [],
            openedAt: "2026-08-14T08:00:00.000Z",
            status: "pending" as const,
          },
        },
        taskIds: [targetTask, otherTask],
        tasks: {
          [targetTask]: {
            sessionId,
            taskId: "task-target",
            name: "Target task",
            status: "running",
            foreground: true,
          },
          [otherTask]: {
            sessionId: otherSessionId,
            taskId: "task-other",
            name: "Other task",
            status: "running",
            foreground: true,
          },
        },
        mcpServerIds: [targetMcp, otherMcp],
        mcpServers: {
          [targetMcp]: { sessionId, name: "mcp-target", status: "connected" as const },
          [otherMcp]: { sessionId: otherSessionId, name: "mcp-other", status: "connected" as const },
        },
        runtime: {
          [sessionId]: {
            sessionId,
            currentModel: "target",
            currentPermissionMode: "default" as const,
            capabilities: [], hooks: [], rawEvents: [], errors: [],
          },
          [otherSessionId]: {
            sessionId: otherSessionId,
            currentModel: "other",
            currentPermissionMode: "auto" as const,
            capabilities: [], hooks: [], rawEvents: [], errors: [],
          },
        },
        checkpointPreviewIds: [checkpointPreviewId, otherCheckpointPreviewId],
        checkpointPreviews: {
          [checkpointPreviewId]: {
            id: checkpointPreviewId,
            sessionId,
            userMessageId: "00000000-0000-4000-8000-000000000b05",
            scope: "files" as const,
            expiresAt: "2026-08-14T08:06:00.000Z",
            canRewind: true,
            status: "ready" as const,
            filesChanged: [],
            insertions: 0,
            deletions: 0,
            failedFiles: [],
          },
          [otherCheckpointPreviewId]: {
            id: otherCheckpointPreviewId,
            sessionId: otherSessionId,
            userMessageId: "00000000-0000-4000-8000-000000000b0a",
            scope: "files" as const,
            expiresAt: "2026-08-14T08:06:00.000Z",
            canRewind: true,
            status: "ready" as const,
            filesChanged: [],
            insertions: 0,
            deletions: 0,
            failedFiles: [],
          },
        },
        checkpointCompletions: {
          [checkpointPreviewId]: {
            sessionId,
            previewId: checkpointPreviewId,
            status: "success" as const,
            failedFiles: [],
          },
          [otherCheckpointPreviewId]: {
            sessionId: otherSessionId,
            previewId: otherCheckpointPreviewId,
            status: "success" as const,
            failedFiles: [],
          },
        },
        commandOwnerships: [
          { commandId, owner: { surface: "runtime" as const, control: "model" as const, sessionId } },
          { commandId: otherCommand, owner: { surface: "runtime" as const, control: "model" as const, sessionId: otherSessionId } },
          { commandId: workspaceCommand, owner: { surface: "workspace" as const, control: "pick" as const } },
        ],
        commandFailures: [
          { commandId, sessionId, error: { code: "TARGET", message: "target", retryable: true } },
          { commandId: otherCommand, sessionId: otherSessionId, error: { code: "OTHER", message: "other", retryable: true } },
          { commandId: workspaceCommand, error: { code: "WORKSPACE", message: "workspace", retryable: true } },
        ],
      };

      const reduced = reduceServerFrame(state, {
        kind: "events",
        events: [{
          serverEpoch: "epoch-a",
          sequence: 8,
          occurredAt: "2026-08-14T08:01:00.000Z",
          sessionId,
          type: "session.removed",
          payload: { sessionId },
        }],
      }).state;

      expect(reduced).toMatchObject({
        sessionIds: [otherSessionId],
        queuedInputIds: [otherInput],
        interactionIds: [otherInteraction],
        taskIds: [otherTask],
        mcpServerIds: [otherMcp],
        checkpointPreviewIds: [otherCheckpointPreviewId],
        selectedSessionId: expectedSelected,
        settingsOpen: expectedSettingsOpen,
        detailsSelection: null,
        commandOwnerships: [
          expect.objectContaining({ commandId: otherCommand }),
          expect.objectContaining({ commandId: workspaceCommand }),
        ],
        commandFailures: [
          expect.objectContaining({ commandId: otherCommand }),
          expect.objectContaining({ commandId: workspaceCommand }),
        ],
      });
      for (const collection of [
        reduced.sessions,
        reduced.messages,
        reduced.queuedInputs,
        reduced.interactions,
        reduced.tasks,
        reduced.mcpServers,
        reduced.runtime,
        reduced.checkpointPreviews,
        reduced.checkpointCompletions,
      ]) {
        expect(JSON.stringify(collection)).not.toContain(sessionId);
        expect(JSON.stringify(collection)).toContain(otherSessionId);
      }
    },
  );
});
