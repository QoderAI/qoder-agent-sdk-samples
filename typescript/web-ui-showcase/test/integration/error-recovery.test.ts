import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ProtocolVersionMismatchError } from "@qoder-ai/qoder-agent-sdk";
import { createApp } from "../../src/server/app.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import type { QueryFactory } from "../../src/server/sdk/query-factory.js";
import {
  createFakeQueryFactory,
} from "../fixtures/fake-query.js";
import {
  FixtureSessionCatalog,
  FixtureWorkspaceRepository,
} from "../fixtures/fake-sdk-runtime.js";

let app: FastifyInstance | undefined;
afterEach(async () => { await app?.close(); app = undefined; });

describe("safe HTTP error recovery", () => {
  it("classifies invalid, missing, and unexpected failures without leaking details", async () => {
    app = await createApp({ assetRoot: null });
    app.get("/__test/unexpected", async () => {
      throw new Error("test-secret-marker");
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: "REQUEST_INVALID" });

    const missing = await app.inject({
      method: "POST",
      url: "/api/sessions/00000000-0000-4000-8000-000000000f01/ensure",
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "SESSION_NOT_FOUND" });

    const unexpected = await app.inject({ method: "GET", url: "/__test/unexpected" });
    expect(unexpected.statusCode).toBe(500);
    expect(unexpected.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "The local server could not complete the request.",
      retryable: false,
    });
    expect(unexpected.body).not.toContain("test-secret-marker");
    expect(unexpected.body).not.toContain("stack");
  });

  it("keeps a specific SDK startup failure on the Session and permits a later ensure", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000000f11";
    const sessionId = "00000000-0000-4000-8000-000000000f12";
    const repository = new FixtureWorkspaceRepository();
    await repository.upsert({
      id: workspaceId,
      displayName: "recovery-fixture",
      path: "/recovery-fixture",
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z",
    });
    const catalog = new FixtureSessionCatalog();
    catalog.ensureSession("/recovery-fixture", sessionId);
    const journal = new EventJournal({
      epoch: "error-recovery",
      capacity: 100,
    });
    const realFactory = createFakeQueryFactory(catalog);
    let attempt = 0;
    const queryFactory: QueryFactory = {
      create(input) {
        const query = realFactory.create(input);
        attempt += 1;
        if (attempt === 1) {
          query.initializationResult = async () => {
            throw new ProtocolVersionMismatchError("2.0.0", "1.0.0");
          };
        }
        return query;
      },
    };
    app = await createApp({
      assetRoot: null,
      journal,
      workspaceRepository: repository,
      directoryPicker: { pick: async () => null },
      sessionCatalog: catalog,
      queryFactory,
    });

    const failedEnsure = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    expect(failedEnsure.statusCode).toBe(202);
    await expect.poll(() => {
      const replay = journal.replay({ epoch: journal.epoch, after: 0 });
      if (replay.kind !== "events") return undefined;
      return replay.events.find((event) => event.type === "command.failed")
        ?.payload.error.code;
    }).toBe("SDK_PROTOCOL_VERSION_MISMATCH");
    const unavailable = await app.inject({
      method: "GET",
      url: `/api/snapshot?sessionId=${sessionId}`,
    });
    expect(unavailable.json()).toMatchObject({
      sessions: [{
        id: sessionId,
        phase: "restorable",
        failure: {
          code: "SDK_PROTOCOL_VERSION_MISMATCH",
          message: "SDK 与本地 Qoder CLI 的协议版本不兼容。",
        },
      }],
    });
    expect(unavailable.body).not.toContain("stack");

    const retry = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/ensure`,
      payload: {},
    });
    expect(retry.statusCode).toBe(202);
    await expect.poll(async () => {
      const snapshot = await app?.inject({
        method: "GET",
        url: `/api/snapshot?sessionId=${sessionId}`,
      });
      return snapshot?.json().sessions[0]?.phase;
    }).toBe("idle");
    expect(attempt).toBe(2);
  });
});
