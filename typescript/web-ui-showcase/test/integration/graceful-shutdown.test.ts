import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server/app.js";
import { createJsonWorkspaceRepository } from "../../src/server/persistence/workspace-repository.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { InteractionBroker } from "../../src/server/sdk/interaction-broker.js";
import { SessionRegistry } from "../../src/server/sdk/session-registry.js";
import { createShutdown } from "../../src/server/shutdown.js";
import type { EventEnvelope } from "../../src/shared/events.js";
import { createFakeQueryFactory, FakeQuery } from "../fixtures/fake-query.js";
import { FixtureSessionCatalog } from "../fixtures/fake-sdk-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
  vi.restoreAllMocks();
});

function waitForIdleSession(journal: EventJournal): Promise<string> {
  return new Promise((resolve) => {
    const unsubscribe = journal.subscribe((event: EventEnvelope) => {
      if (event.type === "session.upserted" && event.payload.phase === "idle") {
        unsubscribe();
        resolve(event.payload.id);
      }
    });
  });
}

describe("production shutdown", () => {
  it("closes every Query and pending interaction exactly once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "qoder-webui-shutdown-"));
    temporaryDirectories.push(directory);
    const storePath = join(directory, "workspaces.json");
    const repository = createJsonWorkspaceRepository(storePath);
    const workspaceId = "00000000-0000-4000-8000-000000000f01";
    await repository.upsert({
      id: workspaceId,
      displayName: "shutdown-fixture",
      path: directory,
      createdAt: "2026-08-14T10:00:00.000Z",
      updatedAt: "2026-08-14T10:00:00.000Z",
    });
    const journal = new EventJournal({
      epoch: "shutdown-epoch",
      capacity: 100,
    });
    const catalog = new FixtureSessionCatalog();
    const registry = new SessionRegistry();
    const interactions = new InteractionBroker({ journal });
    const close = vi.spyOn(FakeQuery.prototype, "close");
    const app = await createApp({
      assetRoot: null,
      journal,
      workspaceRepository: repository,
      directoryPicker: { pick: async () => null },
      sessionCatalog: catalog,
      queryFactory: createFakeQueryFactory(catalog),
      sessionRegistry: registry,
      interactionBroker: interactions,
    });

    const firstIdle = waitForIdleSession(journal);
    await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: { workspaceId, text: "启动第一个关闭测试 Session" },
    });
    const firstSessionId = await firstIdle;
    const secondIdle = waitForIdleSession(journal);
    await app.inject({
      method: "POST",
      url: "/api/sessions/start",
      payload: { workspaceId, text: "启动第二个关闭测试 Session" },
    });
    await secondIdle;

    const pending = interactions.canUseTool(() => firstSessionId)(
      "Write",
      { file_path: "README.md" },
      {
        signal: new AbortController().signal,
        toolUseID: "shutdown-tool",
      },
    );
    const pendingOutcome = pending.then(
      () => "resolved",
      () => "rejected",
    );
    const shutdown = createShutdown(app, () => undefined);

    const first = shutdown("SIGTERM");
    const repeated = shutdown("SIGINT");
    expect(repeated).toBe(first);
    await first;

    expect(close).toHaveBeenCalledTimes(2);
    expect(await pendingOutcome).toBe("rejected");
    expect(registry.list()).toHaveLength(0);
    await expect(app.inject({ method: "GET", url: "/api/health" })).rejects.toThrow();
    expect(JSON.parse(await readFile(storePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      workspaces: [{ id: workspaceId }],
    });
  });
});
