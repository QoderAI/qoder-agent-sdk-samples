import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";

class MemoryWorkspaceRepository implements WorkspaceRepository {
  readonly workspaces = new Map<string, StoredWorkspace>();

  async list(): Promise<StoredWorkspace[]> {
    return [...this.workspaces.values()];
  }

  async upsert(workspace: StoredWorkspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async remove(workspaceId: string): Promise<void> {
    this.workspaces.delete(workspaceId);
  }
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("Workspace file suggestions", () => {
  it("rejects an unknown Session with a safe error", async () => {
    app = await createApp({
      assetRoot: null,
      workspaceRepository: new MemoryWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/sessions/00000000-0000-4000-8000-000000000d01/files?q=src",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "SESSION_NOT_FOUND",
      message: "The selected Session no longer exists.",
      retryable: false,
    });
  });

  it("rejects file queries longer than 200 characters", async () => {
    app = await createApp({
      assetRoot: null,
      workspaceRepository: new MemoryWorkspaceRepository(),
      directoryPicker: { pick: async () => null },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/sessions/00000000-0000-4000-8000-000000000d01/files?q=${"a".repeat(201)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "REQUEST_INVALID",
      retryable: false,
    });
  });
});
