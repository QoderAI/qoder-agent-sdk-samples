import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/server/app.js";
import type { DirectoryPicker } from "../../src/server/platform/directory-picker.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { WorkspaceService } from "../../src/server/services/workspace-service.js";
import type { EventEnvelope } from "../../src/shared/events.js";

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, StoredWorkspace>();

  async list(): Promise<StoredWorkspace[]> {
    return [...this.workspaces.values()];
  }

  async registerOrGetByPath(
    workspace: StoredWorkspace,
  ): Promise<StoredWorkspace> {
    const existing = [...this.workspaces.values()].find(
      (candidate) => candidate.path === workspace.path,
    );
    if (existing !== undefined) return existing;
    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  async upsert(workspace: StoredWorkspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async remove(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
  }
}

const temporaryDirectories: string[] = [];
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function makeProject(name: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `qoder-${name}-`));
  temporaryDirectories.push(directory);
  return realpath(directory);
}

function waitForEvent(
  journal: EventJournal,
  predicate: (event: EventEnvelope) => boolean,
): Promise<EventEnvelope> {
  return new Promise((resolve) => {
    const unsubscribe = journal.subscribe((event) => {
      if (predicate(event)) {
        unsubscribe();
        resolve(event);
      }
    });
  });
}

describe("Workspace commands", () => {
  it("serializes removal behind active Workspace use and rejects later use", async () => {
    const path = await makeProject("workspace-fence");
    const repository = new MemoryWorkspaceRepository();
    const workspaces = new WorkspaceService({
      repository,
      picker: { pick: async () => null },
      journal: new EventJournal({ epoch: "workspace-fence", capacity: 20 }),
      createUuid: () => "00000000-0000-4000-8000-000000000804",
    });
    const workspace = await workspaces.register(path);
    let releaseUse: (() => void) | undefined;
    const useGate = new Promise<void>((resolve) => {
      releaseUse = resolve;
    });
    let useStarted = false;
    const activeUse = workspaces.withWorkspace(workspace.id, async () => {
      useStarted = true;
      await useGate;
    });
    await vi.waitFor(() => expect(useStarted).toBe(true));

    const removal = workspaces.remove(
      workspace.id,
      "00000000-0000-4000-8000-000000000805",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.workspaces.has(workspace.id)).toBe(true);
    releaseUse?.();
    await Promise.all([activeUse, removal]);

    await expect(
      workspaces.withWorkspace(workspace.id, async () => undefined),
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND" });
  });

  it("registers a filesystem root with its canonical path as display name", async () => {
    const canonicalRoot = await realpath("/");
    const repository = new MemoryWorkspaceRepository();
    const workspaces = new WorkspaceService({
      repository,
      picker: { pick: async () => null },
      journal: new EventJournal({ epoch: "root-workspace", capacity: 10 }),
      now: () => "2026-08-14T08:00:00.000Z",
      createUuid: () => "00000000-0000-4000-8000-000000000803",
    });

    const workspace = await workspaces.register(canonicalRoot);

    expect(workspace).toMatchObject({
      path: canonicalRoot,
      displayName: canonicalRoot,
    });
  });

  it("returns one persisted Workspace when the same path is registered concurrently", async () => {
    const path = await makeProject("concurrent-register");
    const repository = new MemoryWorkspaceRepository();
    const ids = [
      "00000000-0000-4000-8000-000000000821",
      "00000000-0000-4000-8000-000000000822",
    ];
    const workspaces = new WorkspaceService({
      repository,
      picker: { pick: async () => null },
      journal: new EventJournal({ epoch: "concurrent-register", capacity: 10 }),
      createUuid: () => ids.shift() ?? "00000000-0000-4000-8000-000000000823",
    });

    const [first, second] = await Promise.all([
      workspaces.register(path),
      workspaces.register(path),
    ]);

    expect(first.id).toBe(second.id);
    expect([...repository.workspaces.values()]).toEqual([first]);
  });

  it("lists a touched Workspace first without changing its id or path", async () => {
    const firstPath = await makeProject("recent-first");
    const secondPath = await makeProject("recent-second");
    const repository = new MemoryWorkspaceRepository();
    const times = [
      "2026-08-14T06:00:00.000Z",
      "2026-08-14T07:00:00.000Z",
      "2026-08-14T08:00:00.000Z",
    ];
    const workspaces = new WorkspaceService({
      repository,
      picker: { pick: async () => null },
      journal: new EventJournal({ epoch: "recent-workspaces", capacity: 20 }),
      now: () => times.shift() ?? "2026-08-14T09:00:00.000Z",
      createUuid: (() => {
        const ids = [
          "00000000-0000-4000-8000-000000000801",
          "00000000-0000-4000-8000-000000000802",
        ];
        return () => ids.shift() ?? "00000000-0000-4000-8000-000000000803";
      })(),
    });
    const first = await workspaces.register(firstPath, "00000000-0000-4000-8000-000000000811");
    const second = await workspaces.register(secondPath, "00000000-0000-4000-8000-000000000812");

    const touched = await workspaces.touch(first.id);

    expect(await workspaces.list()).toMatchObject([touched, second]);
    expect(touched).toMatchObject({ id: first.id, path: first.path });
    expect(repository.workspaces.get(first.id)).toMatchObject({
      id: first.id,
      path: first.path,
    });
  });

  it("registers, picks, and removes local projects through accepted commands", async () => {
    const manualPath = await makeProject("manual");
    const pickedPath = await makeProject("picked");
    const repository = new MemoryWorkspaceRepository();
    const picker: DirectoryPicker = {
      pick: async () => pickedPath,
    };
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 20 });
    app = await createApp({
      assetRoot: null,
      journal,
      workspaceRepository: repository,
      directoryPicker: picker,
    });

    const manualEvent = waitForEvent(
      journal,
      (event) => event.type === "workspace.upserted",
    );
    const manualResponse = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { path: manualPath },
    });
    expect(manualResponse.statusCode).toBe(202);
    const manualCommandId = manualResponse.json<{ commandId: string }>().commandId;
    expect((await manualEvent).commandId).toBe(manualCommandId);

    const pickedEvent = waitForEvent(
      journal,
      (event) =>
        event.type === "workspace.upserted" &&
        event.payload.path === pickedPath,
    );
    const pickResponse = await app.inject({
      method: "POST",
      url: "/api/workspaces/pick",
    });
    expect(pickResponse.statusCode).toBe(202);
    expect((await pickedEvent).commandId).toBe(
      pickResponse.json<{ commandId: string }>().commandId,
    );

    const selected = [...repository.workspaces.values()].find(
      (workspace) => workspace.path === manualPath,
    );
    expect(selected).toBeDefined();
    const removedEvent = waitForEvent(
      journal,
      (event) => event.type === "workspace.removed",
    );
    const removeResponse = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${selected?.id}`,
    });
    expect(removeResponse.statusCode).toBe(202);
    expect((await removedEvent).commandId).toBe(
      removeResponse.json<{ commandId: string }>().commandId,
    );
    expect(repository.workspaces.has(selected?.id ?? "")).toBe(false);
  });

  it("reports invalid paths as correlated safe command failures", async () => {
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 20 });
    app = await createApp({
      assetRoot: null,
      journal,
      workspaceRepository: new MemoryWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
    });
    const failedEvent = waitForEvent(
      journal,
      (event) => event.type === "command.failed",
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { path: "relative/project" },
    });
    const commandId = response.json<{ commandId: string }>().commandId;
    const failure = await failedEvent;

    expect(response.statusCode).toBe(202);
    expect(failure).toMatchObject({
      commandId,
      type: "command.failed",
      payload: {
        error: {
          code: "WORKSPACE_PATH_NOT_ABSOLUTE",
          retryable: true,
        },
      },
    });
    expect(JSON.stringify(failure)).not.toContain("stack");
  });
});
