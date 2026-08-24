import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createJsonWorkspaceRepository,
  type StoredWorkspace,
} from "../../../../src/server/persistence/workspace-repository.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function createStorePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "qoder-workspace-store-"));
  temporaryDirectories.push(directory);
  return join(directory, "workspaces.json");
}

const first: StoredWorkspace = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "first",
  path: "/projects/first",
  createdAt: "2026-08-14T08:00:00.000Z",
  updatedAt: "2026-08-14T08:00:00.000Z",
};
const second: StoredWorkspace = {
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "second",
  path: "/projects/second",
  createdAt: "2026-08-14T09:00:00.000Z",
  updatedAt: "2026-08-14T09:00:00.000Z",
};

describe("JSON Workspace repository", () => {
  it("loads an empty collection when the store does not exist", async () => {
    const path = await createStorePath();
    const repository = createJsonWorkspaceRepository(path);

    expect(await repository.list()).toEqual([]);
  });

  it("atomically returns the persisted Workspace for a duplicate path", async () => {
    const path = await createStorePath();
    const repository = createJsonWorkspaceRepository(path);
    const duplicate = {
      ...second,
      path: first.path,
    };

    const [registered, existing] = await Promise.all([
      repository.registerOrGetByPath(first),
      repository.registerOrGetByPath(duplicate),
    ]);

    expect(registered).toEqual(first);
    expect(existing).toEqual(first);
    expect(await repository.list()).toEqual([first]);
  });

  it("rejects persisted metadata containing duplicate paths", async () => {
    const path = await createStorePath();
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 1,
        workspaces: [first, { ...second, path: first.path }],
      }),
      "utf8",
    );

    await expect(createJsonWorkspaceRepository(path).list()).rejects.toMatchObject({
      code: "WORKSPACE_STORE_INVALID",
      retryable: false,
    });
  });

  it("persists upserts and removals as valid versioned JSON", async () => {
    const path = await createStorePath();
    const repository = createJsonWorkspaceRepository(path);
    await repository.upsert(first);
    await repository.upsert(second);

    expect(await createJsonWorkspaceRepository(path).list()).toEqual([
      first,
      second,
    ]);

    await repository.remove(first.id);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: 1,
      workspaces: [second],
    });
  });
});
