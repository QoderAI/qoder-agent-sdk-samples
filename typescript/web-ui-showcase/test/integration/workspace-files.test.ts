import { request as httpRequest } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { registerWorkspaceFileRoutes } from "../../src/server/api/workspace-file-routes.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";
import type { WorkspaceFileService } from "../../src/server/services/workspace-file-service.js";

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

  it("aborts an in-flight file search when the HTTP client disconnects", async () => {
    let observedSignal: AbortSignal | undefined;
    let markEntered: (() => void) | undefined;
    let markAborted: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve;
    });
    const workspaceFiles = {
      search: async (
        _sessionId: string,
        _query: string,
        signal?: AbortSignal,
      ) => {
        observedSignal = signal;
        markEntered?.();
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            markAborted?.();
            resolve();
          }, { once: true });
        });
        return { items: [], truncated: false };
      },
    };
    app = Fastify();
    await registerWorkspaceFileRoutes(app, {
      workspaceFiles: workspaceFiles as unknown as WorkspaceFileService,
    });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const clientRequest = httpRequest(
      `${address}/api/sessions/00000000-0000-4000-8000-000000000d01/files?q=src`,
    );
    clientRequest.on("error", () => undefined);
    clientRequest.end();

    await entered;
    clientRequest.destroy();
    await aborted;

    expect(observedSignal?.aborted).toBe(true);
  });
});
