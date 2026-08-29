import { describe, expect, it, vi } from "vitest";
import type { ConversationItem, WorkspaceView } from "../../../../src/shared/model.js";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import { SnapshotService } from "../../../../src/server/services/snapshot-service.js";
import type {
  HistoricalMessage,
  SessionCatalog,
} from "../../../../src/server/services/session-catalog-port.js";
import type { WorkspaceService } from "../../../../src/server/services/workspace-service.js";

const workspaceId = "00000000-0000-4000-8000-000000000101";
const sessionId = "00000000-0000-4000-8000-000000000102";
const historyMessageId = "00000000-0000-4000-8000-000000000103";
const liveMessageId = "00000000-0000-4000-8000-000000000104";
const replacementMessageId = "00000000-0000-4000-8000-000000000105";
const timestamp = "2026-08-22T08:00:00.000Z";
const workspace: WorkspaceView = {
  id: workspaceId,
  displayName: "fixture",
  path: "/fixture",
  createdAt: timestamp,
  updatedAt: timestamp,
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function historicalUser(id = historyMessageId): HistoricalMessage {
  return {
    type: "user",
    id,
    sessionId,
    message: { role: "user", content: "stored" },
    parentToolUseId: null,
    timestamp,
  };
}

function liveUser(id = liveMessageId, text = "live"): ConversationItem {
  return {
    id,
    sessionId,
    kind: "user",
    text,
    createdAt: timestamp,
  };
}

async function createHarness(
  messages: SessionCatalog["messages"],
): Promise<{ service: SnapshotService; journal: EventJournal }> {
  const journal = new EventJournal({
    epoch: "snapshot-race",
    capacity: 20,
    now: () => timestamp,
  });
  const catalog = {
    listForWorkspace: async () => [
      {
        id: sessionId,
        cwd: workspace.path,
        title: "Fixture",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    messages,
  } as unknown as SessionCatalog;
  const workspaceService = {
    list: async () => [workspace],
  } as unknown as WorkspaceService;
  const service = new SnapshotService({
    workspaceService,
    sessionCatalog: catalog,
    journal,
  });
  await service.hydrate();
  return { service, journal };
}

describe("SnapshotService history consistency", () => {
  it("deduplicates history loads and replays live items before committing the cursor", async () => {
    const history = deferred<HistoricalMessage[]>();
    const messages = vi.fn(async () => history.promise);
    const { service, journal } = await createHarness(messages);

    const first = service.snapshot(sessionId);
    const second = service.snapshot(sessionId);
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(1));
    journal.publish(
      {
        type: "conversation.item",
        payload: { sessionId, item: liveUser() },
      },
      { sessionId },
    );
    history.resolve([historicalUser()]);

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
    expect(firstSnapshot.cursor).toBe(1);
    expect(firstSnapshot.messages[sessionId]?.map((item) => item.id)).toEqual([
      historyMessageId,
      liveMessageId,
    ]);
    expect(secondSnapshot.messages).toEqual(firstSnapshot.messages);
    service.close();
  });

  it("keeps an authoritative replacement when an older history read finishes", async () => {
    const history = deferred<HistoricalMessage[]>();
    const messages = vi.fn(async () => history.promise);
    const { service, journal } = await createHarness(messages);

    const loading = service.loadSession(sessionId);
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(1));
    journal.publish(
      {
        type: "conversation.replaced",
        payload: {
          sessionId,
          items: [liveUser(replacementMessageId, "replacement")],
        },
      },
      { sessionId },
    );
    history.resolve([historicalUser()]);
    await loading;

    const snapshot = await service.snapshot(sessionId);
    expect(snapshot.messages[sessionId]?.map((item) => item.id)).toEqual([
      replacementMessageId,
    ]);
    service.close();
  });

  it("does not commit an in-flight history read after Session removal", async () => {
    const history = deferred<HistoricalMessage[]>();
    const messages = vi.fn(async () => history.promise);
    const { service, journal } = await createHarness(messages);

    const loading = service.loadSession(sessionId);
    await vi.waitFor(() => expect(messages).toHaveBeenCalledTimes(1));
    journal.publish(
      { type: "session.removed", payload: { sessionId } },
      { sessionId },
    );
    journal.publish(
      {
        type: "conversation.item",
        payload: { sessionId, item: liveUser() },
      },
      { sessionId },
    );
    history.resolve([historicalUser()]);

    await expect(loading).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    const snapshot = await service.snapshot();
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.messages).toEqual({});
    service.close();
  });
});
