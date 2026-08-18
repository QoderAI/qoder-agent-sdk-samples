import type { EventEnvelope } from "../../shared/events.js";
import type { ServerFrame } from "../../shared/frames.js";
import type { AppSnapshot } from "../../shared/snapshots.js";
import {
  DETAILS_DEFAULT,
  SIDEBAR_DEFAULT,
} from "../features/layout/columns.js";
import type { AppState } from "./app-state.js";
import { COMMAND_CORRELATION_LIMIT } from "./command-ownership.js";

export type ReduceFrameResult = {
  state: AppState;
  needsSnapshot: boolean;
};

function indexById<T extends { id: string }>(values: T[]): Record<string, T> {
  return Object.fromEntries(values.map((value) => [value.id, value]));
}

function indexBy<T>(
  values: T[],
  key: (value: T) => string,
): Record<string, T> {
  return Object.fromEntries(values.map((value) => [key(value), value]));
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...remaining } = record;
  return remaining;
}

function upsertId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

function removeId(ids: string[], id: string): string[] {
  return ids.filter((candidate) => candidate !== id);
}

function withoutSession<T extends { sessionId: string }>(
  record: Record<string, T>,
  sessionId: string,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value.sessionId !== sessionId),
  );
}

function removeSession(state: AppState, sessionId: string): AppState {
  const removedCommandIds = new Set(
    state.commandOwnerships.flatMap((entry) =>
      "sessionId" in entry.owner && entry.owner.sessionId === sessionId
        ? [entry.commandId]
        : [],
    ),
  );
  const selectedRemoved = state.selectedSessionId === sessionId;
  const queuedInputs = withoutSession(state.queuedInputs, sessionId);
  const interactions = withoutSession(state.interactions, sessionId);
  const tasks = withoutSession(state.tasks, sessionId);
  const mcpServers = withoutSession(state.mcpServers, sessionId);
  return {
    ...state,
    sessionIds: removeId(state.sessionIds, sessionId),
    sessions: without(state.sessions, sessionId),
    messages: without(state.messages, sessionId),
    queuedInputIds: state.queuedInputIds.filter((id) => queuedInputs[id] !== undefined),
    queuedInputs,
    interactionIds: state.interactionIds.filter((id) => interactions[id] !== undefined),
    interactions,
    taskIds: state.taskIds.filter((id) => tasks[id] !== undefined),
    tasks,
    mcpServerIds: state.mcpServerIds.filter((id) => mcpServers[id] !== undefined),
    mcpServers,
    runtime: without(state.runtime, sessionId),
    commandOwnerships: state.commandOwnerships.filter(
      (entry) => !removedCommandIds.has(entry.commandId),
    ),
    commandFailures: state.commandFailures.filter(
      (failure) =>
        failure.sessionId !== sessionId &&
        (failure.commandId === undefined ||
          !removedCommandIds.has(failure.commandId)),
    ),
    selectedSessionId: selectedRemoved ? null : state.selectedSessionId,
    settingsOpen: selectedRemoved ? false : state.settingsOpen,
    detailsSelection:
      state.detailsSelection?.sessionId === sessionId
        ? null
        : state.detailsSelection,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled server event: ${JSON.stringify(value)}`);
}

export function createInitialState(): AppState {
  return {
    serverEpoch: null,
    cursor: 0,
    workspaceIds: [],
    workspaces: {},
    sessionIds: [],
    sessions: {},
    messages: {},
    queuedInputIds: [],
    queuedInputs: {},
    interactionIds: [],
    interactions: {},
    taskIds: [],
    tasks: {},
    mcpServerIds: [],
    mcpServers: {},
    runtime: {},
    commandFailures: [],
    commandOwnerships: [],
    selectedSessionId: null,
    sidebarWidth: SIDEBAR_DEFAULT,
    preferredDetailsWidth: DETAILS_DEFAULT,
    detailsSelection: null,
    settingsOpen: false,
    sdkConsoleOpen: false,
    sdkConsoleTab: "hooks",
    connectionState: "disconnected",
    protocolError: null,
  };
}

function replaceSnapshot(state: AppState, snapshot: AppSnapshot): AppState {
  const taskKey = (task: AppSnapshot["tasks"][number]) =>
    `${task.sessionId}:${task.taskId}`;
  const mcpKey = (server: AppSnapshot["mcpServers"][number]) =>
    `${server.sessionId}:${server.name}`;
  return {
    ...state,
    serverEpoch: snapshot.serverEpoch,
    cursor: snapshot.cursor,
    workspaceIds: snapshot.workspaces.map((workspace) => workspace.id),
    workspaces: indexById(snapshot.workspaces),
    sessionIds: snapshot.sessions.map((session) => session.id),
    sessions: indexById(snapshot.sessions),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([sessionId, items]) => [
        sessionId,
        [...items],
      ]),
    ),
    queuedInputIds: snapshot.queuedInputs.map((input) => input.uuid),
    queuedInputs: indexBy(snapshot.queuedInputs, (input) => input.uuid),
    interactionIds: snapshot.interactions.map((interaction) => interaction.id),
    interactions: indexById(snapshot.interactions),
    taskIds: snapshot.tasks.map(taskKey),
    tasks: indexBy(snapshot.tasks, taskKey),
    mcpServerIds: snapshot.mcpServers.map(mcpKey),
    mcpServers: indexBy(snapshot.mcpServers, mcpKey),
    runtime: { ...snapshot.runtime },
    protocolError: null,
  };
}

function applyEvent(state: AppState, event: EventEnvelope): AppState {
  switch (event.type) {
    case "workspace.upserted":
      return {
        ...state,
        workspaceIds: upsertId(state.workspaceIds, event.payload.id),
        workspaces: {
          ...state.workspaces,
          [event.payload.id]: event.payload,
        },
      };
    case "workspace.removed":
      return {
        ...state,
        workspaceIds: removeId(
          state.workspaceIds,
          event.payload.workspaceId,
        ),
        workspaces: without(state.workspaces, event.payload.workspaceId),
      };
    case "session.upserted":
      return {
        ...state,
        sessionIds: upsertId(state.sessionIds, event.payload.id),
        sessions: { ...state.sessions, [event.payload.id]: event.payload },
      };
    case "session.removed":
      return removeSession(state, event.payload.sessionId);
    case "session.lifecycle": {
      const current = state.sessions[event.payload.sessionId];
      return current === undefined
        ? state
        : {
            ...state,
            sessions: {
              ...state.sessions,
              [current.id]: { ...current, ...event.payload.lifecycle },
            },
          };
    }
    case "conversation.item": {
      const current = state.messages[event.payload.sessionId] ?? [];
      const index = current.findIndex((item) => item.id === event.payload.item.id);
      const items = [...current];
      if (index === -1) items.push(event.payload.item);
      else items[index] = event.payload.item;
      return {
        ...state,
        messages: { ...state.messages, [event.payload.sessionId]: items },
      };
    }
    case "conversation.replaced":
      return {
        ...state,
        messages: {
          ...state.messages,
          [event.payload.sessionId]: [...event.payload.items],
        },
      };
    case "interaction.opened":
      return {
        ...state,
        interactionIds: upsertId(state.interactionIds, event.payload.id),
        interactions: {
          ...state.interactions,
          [event.payload.id]: event.payload,
        },
      };
    case "interaction.resolved":
      return {
        ...state,
        interactionIds: removeId(
          state.interactionIds,
          event.payload.interactionId,
        ),
        interactions: without(
          state.interactions,
          event.payload.interactionId,
        ),
      };
    case "input.upserted":
      return {
        ...state,
        queuedInputIds: upsertId(state.queuedInputIds, event.payload.uuid),
        queuedInputs: {
          ...state.queuedInputs,
          [event.payload.uuid]: event.payload,
        },
      };
    case "input.removed":
      return {
        ...state,
        queuedInputIds: removeId(
          state.queuedInputIds,
          event.payload.messageUuid,
        ),
        queuedInputs: without(
          state.queuedInputs,
          event.payload.messageUuid,
        ),
      };
    case "task.upserted": {
      const key = `${event.payload.sessionId}:${event.payload.taskId}`;
      return {
        ...state,
        taskIds: upsertId(state.taskIds, key),
        tasks: { ...state.tasks, [key]: event.payload },
      };
    }
    case "task.removed": {
      const key = `${event.payload.sessionId}:${event.payload.taskId}`;
      return {
        ...state,
        taskIds: removeId(state.taskIds, key),
        tasks: without(state.tasks, key),
      };
    }
    case "mcp.status": {
      const key = `${event.payload.sessionId}:${event.payload.name}`;
      return {
        ...state,
        mcpServerIds: upsertId(state.mcpServerIds, key),
        mcpServers: { ...state.mcpServers, [key]: event.payload },
      };
    }
    case "runtime.updated":
      return {
        ...state,
        runtime: {
          ...state.runtime,
          [event.payload.sessionId]: event.payload.runtime,
        },
      };
    case "checkpoint.previewed":
    case "checkpoint.removed":
    case "checkpoint.completed":
      return state;
    case "command.failed":
      return {
        ...state,
        commandFailures: [
          ...state.commandFailures,
          {
            error: event.payload.error,
            ...(event.commandId === undefined
              ? {}
              : { commandId: event.commandId }),
            ...(event.sessionId === undefined
              ? {}
              : { sessionId: event.sessionId }),
          },
        ].slice(-COMMAND_CORRELATION_LIMIT),
      };
    default:
      return assertNever(event);
  }
}

export function reduceServerFrame(
  state: AppState,
  frame: ServerFrame,
): ReduceFrameResult {
  if (frame.kind === "snapshot") {
    return { state: replaceSnapshot(state, frame.snapshot), needsSnapshot: false };
  }
  const original = state;
  let next = state;
  for (const event of frame.events) {
    if (next.serverEpoch === null || event.serverEpoch !== next.serverEpoch) {
      return { state: original, needsSnapshot: true };
    }
    if (event.sequence <= next.cursor) continue;
    if (event.sequence !== next.cursor + 1) {
      return { state: original, needsSnapshot: true };
    }
    next = { ...applyEvent(next, event), cursor: event.sequence };
  }
  return { state: next, needsSnapshot: false };
}
