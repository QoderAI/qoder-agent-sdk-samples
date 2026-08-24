import { describe, expect, it, vi } from "vitest";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { CheckpointService } from "../../src/server/sdk/checkpoint-service.js";
import type { QueryPort } from "../../src/server/sdk/query-port.js";
import type { SessionController } from "../../src/server/sdk/session-controller.js";
import { SessionRegistry } from "../../src/server/sdk/session-registry.js";
import type { SessionCatalog } from "../../src/server/services/session-catalog-port.js";

const sessionId = "00000000-0000-4000-8000-000000000a01";
const messageId = "00000000-0000-4000-8000-000000000a02";
const previewId = "00000000-0000-4000-8000-000000000a03";

function setup(capabilities = ["session_rewind_v1"]) {
  const journal = new EventJournal({ epoch: "epoch-checkpoint", capacity: 100 });
  const rewindFiles = vi.fn(async (_id: string, options?: { dryRun?: boolean }) => ({
    canRewind: true,
    filesChanged: ["src/app.ts"],
    insertions: 3,
    deletions: 1,
    dryRun: options?.dryRun,
  }));
  const rewind = vi.fn(async (_id: string, options?: { scope?: string; dryRun?: boolean }) => ({
    status: options?.dryRun ? "ready" as const : "success" as const,
    targetUserMessageId: messageId,
    scope: options?.scope ?? "both",
    filesChanged: ["src/app.ts"],
    insertions: 3,
    deletions: 1,
    failedFiles: [],
  }));
  const query = { rewindFiles, rewind } as unknown as QueryPort;
  let revision = 0;
  let lifecycle: ReturnType<SessionController["lifecycle"]> = {
    phase: "idle",
    awaitingUser: false,
  };
  const controller = {
    query: () => query,
    capabilities: () => capabilities,
    lifecycle: () => ({ ...lifecycle }),
    transcriptRevision: () => revision,
    bumpTranscriptRevision: () => ++revision,
  } as unknown as SessionController;
  const registry = new SessionRegistry();
  registry.reserve(sessionId, controller);
  const catalog = {
    messages: vi.fn(async () => [
      {
        type: "user" as const,
        id: messageId,
        sessionId,
        message: { role: "user", content: "Restored prompt" },
        parentToolUseId: null,
        timestamp: "2026-08-14T08:00:00.000Z",
      },
    ]),
  } as unknown as SessionCatalog;
  const previewIds = [
    previewId,
    "00000000-0000-4000-8000-000000000a04",
    "00000000-0000-4000-8000-000000000a05",
  ];
  const service = new CheckpointService({
    registry,
    catalog,
    journal,
    getSession: () => ({ cwd: "/repo" }),
    createUuid: () => previewIds.shift() ?? crypto.randomUUID(),
    now: () => new Date("2026-08-14T08:00:00.000Z"),
  });
  return {
    service,
    journal,
    registry,
    rewindFiles,
    rewind,
    catalog,
    controller,
    setLifecycle: (next: ReturnType<SessionController["lifecycle"]>) => {
      lifecycle = next;
    },
  };
}

describe("Checkpoint previews", () => {
  it("keeps a terminal Session operation behind an in-flight preview", async () => {
    const { service, registry, rewindFiles } = setup();
    let releasePreview: (() => void) | undefined;
    const previewGate = new Promise<{
      canRewind: true;
      filesChanged: string[];
      insertions: number;
      deletions: number;
      dryRun: true;
    }>((resolve) => {
      releasePreview = () => resolve({
        canRewind: true,
        filesChanged: ["src/app.ts"],
        insertions: 3,
        deletions: 1,
        dryRun: true,
      });
    });
    rewindFiles.mockImplementationOnce(async () => previewGate);

    const preview = service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });
    await vi.waitFor(() => expect(rewindFiles).toHaveBeenCalledOnce());
    let terminalStarted = false;
    const terminal = registry.runExclusive(sessionId, async () => {
      terminalStarted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalStarted).toBe(false);
    releasePreview?.();
    await Promise.all([preview, terminal]);
    expect(terminalStarted).toBe(true);
  });

  it("binds a one-use file dry run to execution and refreshes history", async () => {
    const { service, journal, rewindFiles, catalog } = setup();
    const preview = await service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });

    expect(preview).toMatchObject({
      id: previewId,
      sessionId,
      userMessageId: messageId,
      scope: "files",
      canRewind: true,
      status: "ready",
      filesChanged: ["src/app.ts"],
      insertions: 3,
      deletions: 1,
    });
    expect(rewindFiles).toHaveBeenCalledWith(messageId, { dryRun: true });

    await service.execute(sessionId, {
      previewId,
      userMessageId: messageId,
      scope: "files",
    });

    expect(rewindFiles).toHaveBeenLastCalledWith(messageId);
    expect(catalog.messages).toHaveBeenCalledWith("/repo", sessionId);
    const replay = journal.replay({ epoch: "epoch-checkpoint", after: 0 });
    expect(replay.kind).toBe("events");
    expect(
      replay.kind === "events" ? replay.events.map((event) => event.type) : [],
    ).toEqual(
      expect.arrayContaining([
        "conversation.replaced",
        "checkpoint.completed",
      ]),
    );
    await expect(
      service.execute(sessionId, {
        previewId,
        userMessageId: messageId,
        scope: "files",
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_PREVIEW_INVALID" });
  });

  it("rejects previews while the Session is running or awaiting input", async () => {
    const running = setup();
    running.setLifecycle({ phase: "running", awaitingUser: false });
    await expect(
      running.service.preview(sessionId, {
        userMessageId: messageId,
        scope: "files",
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_SESSION_BUSY" });

    const awaiting = setup();
    awaiting.setLifecycle({ phase: "idle", awaitingUser: true });
    await expect(
      awaiting.service.preview(sessionId, {
        userMessageId: messageId,
        scope: "files",
      }),
    ).rejects.toMatchObject({ code: "CHECKPOINT_SESSION_BUSY" });
  });

  it("discards a dry run when the transcript revision changes", async () => {
    const harness = setup();
    let releasePreview: (() => void) | undefined;
    const previewGate = new Promise<{
      canRewind: true;
      filesChanged: string[];
      insertions: number;
      deletions: number;
      dryRun: true;
    }>((resolve) => {
      releasePreview = () => resolve({
        canRewind: true,
        filesChanged: ["src/app.ts"],
        insertions: 3,
        deletions: 1,
        dryRun: true,
      });
    });
    harness.rewindFiles.mockImplementationOnce(async () => previewGate);

    const preview = harness.service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });
    await vi.waitFor(() => expect(harness.rewindFiles).toHaveBeenCalledOnce());
    harness.controller.bumpTranscriptRevision();
    releasePreview?.();

    await expect(preview).rejects.toMatchObject({
      code: "CHECKPOINT_PREVIEW_STALE",
    });
    expect(harness.service.previews(sessionId)).toEqual([]);
  });

  it("invalidates sibling previews when one preview is executed", async () => {
    const { service, journal } = setup();
    const selected = await service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });
    const sibling = await service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });

    await service.execute(sessionId, {
      previewId: selected.id,
      userMessageId: messageId,
      scope: "files",
    });

    expect(service.previews(sessionId)).toEqual([]);
    const replay = journal.replay({ epoch: "epoch-checkpoint", after: 0 });
    expect(replay.kind).toBe("events");
    const removedIds = replay.kind === "events"
      ? replay.events.flatMap((event) =>
          event.type === "checkpoint.removed"
            ? [event.payload.previewId]
            : [],
        )
      : [];
    expect(removedIds).toEqual([selected.id, sibling.id]);
    await expect(service.execute(sessionId, {
      previewId: sibling.id,
      userMessageId: messageId,
      scope: "files",
    })).rejects.toMatchObject({ code: "CHECKPOINT_PREVIEW_INVALID" });
  });

  it("serializes simultaneous execution and blocks message submission until history reloads", async () => {
    const harness = setup();
    await harness.service.preview(sessionId, {
      userMessageId: messageId,
      scope: "files",
    });
    let releaseExecution: (() => void) | undefined;
    const executionGate = new Promise<{
      canRewind: true;
      filesChanged: string[];
      insertions: number;
      deletions: number;
      dryRun: undefined;
    }>((resolve) => {
      releaseExecution = () => resolve({
        canRewind: true,
        filesChanged: ["src/app.ts"],
        insertions: 3,
        deletions: 1,
        dryRun: undefined,
      });
    });
    harness.rewindFiles.mockImplementationOnce(async () => executionGate);
    const command = {
      previewId,
      userMessageId: messageId,
      scope: "files" as const,
    };

    const first = harness.service.execute(sessionId, command);
    await vi.waitFor(() => expect(harness.rewindFiles).toHaveBeenCalledTimes(2));
    const second = harness.service.execute(sessionId, command);
    expect(() => harness.registry.assertNoPendingMutation(sessionId)).toThrow(
      expect.objectContaining({ code: "SESSION_MUTATION_PENDING" }),
    );
    releaseExecution?.();

    await expect(first).resolves.toBeUndefined();
    await expect(second).rejects.toMatchObject({
      code: "CHECKPOINT_PREVIEW_INVALID",
    });
    expect(harness.registry.hasPendingMutation(sessionId)).toBe(false);
  });

  it("uses full rewind scopes and rejects unsupported conversation rewind", async () => {
    const supported = setup();
    await supported.service.preview(sessionId, {
      userMessageId: messageId,
      scope: "conversation",
    });
    expect(supported.rewind).toHaveBeenCalledWith(messageId, {
      scope: "conversation",
      dryRun: true,
    });

    const unsupported = setup([]);
    await expect(
      unsupported.service.preview(sessionId, {
        userMessageId: messageId,
        scope: "both",
      }),
    ).rejects.toMatchObject({ code: "SDK_CAPABILITY_UNAVAILABLE" });
  });
});
