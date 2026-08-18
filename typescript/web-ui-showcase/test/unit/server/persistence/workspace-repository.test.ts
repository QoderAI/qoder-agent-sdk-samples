import { mkdtemp, readFile, rm } from "node:fs/promises";
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
