import Fastify from "fastify";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryPort } from "../../src/server/sdk/query-port.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { CommandRunner } from "../../src/server/api/command-runner.js";
import { registerRuntimeRoutes } from "../../src/server/api/runtime-routes.js";
import { SessionRuntimeState } from "../../src/server/sdk/session-runtime-state.js";
import { McpService } from "../../src/server/sdk/mcp-service.js";
import { RuntimeCapabilityService } from "../../src/server/sdk/runtime-capability-service.js";
import { SessionRegistry } from "../../src/server/sdk/session-registry.js";
import type { SessionController } from "../../src/server/sdk/session-controller.js";

const sessionId = "00000000-0000-4000-8000-000000000911";
const temporaryDirectories: string[] = [];

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (error) => reject?.(error),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function fakeQuery() {
  return {
    initializationResult: vi.fn(async () => ({
      capabilities: ["background_tasks_v1"],
      commands: [{ name: "help", description: "Help" }],
      agents: [{ name: "general", description: "General" }],
      models: [],
      account: {},
      output_style: "default",
      available_output_styles: ["default"],
    })),
    getAvailableModels: vi.fn(async () => [
      { id: "performance", displayName: "Performance" },
    ]),
    supportedCommands: vi.fn(async () => [
      { name: "help", description: "Help" },
    ]),
    supportedAgents: vi.fn(async () => [
      { name: "general", description: "General" },
    ]),
    listPlugins: vi.fn(async () => {
      throw new Error("plugin endpoint unavailable");
    }),
    accountInfo: vi.fn(async () => ({ email: "developer@example.com" })),
    getContextUsage: vi.fn(async () => ({
      totalTokens: 120,
      maxTokens: 1_000,
      percentage: 12,
      categories: [],
      gridRows: [],
      model: "performance",
      rawMaxTokens: 1_000,
      memoryFiles: [],
      mcpTools: [],
      agents: [],
    })),
    getUsageInfo: vi.fn(async () => null),
    mcpServerStatus: vi.fn(async () => []),
    setModel: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    addDirectories: vi.fn(async (directories: string[]) => ({
      added: directories,
      failed: [],
      directories,
    })),
    stopTask: vi.fn(async () => undefined),
    backgroundTasks: vi.fn(async () => true),
    reloadPlugins: vi.fn(async () => ({ success: true })),
    generateSessionTitle: vi.fn(async () => "Generated title"),
  } as unknown as QueryPort;
}

describe("runtime capability controls", () => {
  it("does not append directory Raw Events when diagnostics are disabled", async () => {
    const journal = new EventJournal({ epoch: "epoch-no-raw", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    registry.reserve(sessionId, {
      query: () => query,
    } as unknown as SessionController);
    const runtimeState = new SessionRuntimeState({ journal });
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
      includeRawEvents: false,
    });

    await runtime.addDirectories(sessionId, [process.cwd()]);

    expect(runtime.snapshot(sessionId).allowedDirectories).toContain(
      process.cwd(),
    );
    expect(runtime.snapshot(sessionId).rawEvents).toEqual([]);
  });

  it("keeps terminal Session work behind an in-flight runtime command", async () => {
    const journal = new EventJournal({ epoch: "epoch-runtime-fence", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const setter = deferred<void>();
    vi.mocked(query.setModel).mockImplementationOnce(() => setter.promise);
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, {
      currentModel: "initial-model",
      currentPermissionMode: "default",
    });
    registry.reserve(sessionId, {
      query: () => query,
    } as unknown as SessionController);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    const command = runtime.setModel(sessionId, "performance");
    await vi.waitFor(() => expect(query.setModel).toHaveBeenCalledOnce());
    let terminalStarted = false;
    const terminal = registry.runExclusive(sessionId, async () => {
      terminalStarted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalStarted).toBe(false);

    setter.resolve(undefined);
    await Promise.all([command, terminal]);
    expect(terminalStarted).toBe(true);
  });

  it("publishes only the newest successful Model and Permission selections", async () => {
    const journal = new EventJournal({ epoch: "epoch-control-state", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const olderModel = deferred<void>();
    const newerModel = deferred<void>();
    vi.mocked(query.setModel)
      .mockImplementationOnce(() => olderModel.promise)
      .mockImplementationOnce(() => newerModel.promise);
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, {
      currentModel: "initial-model",
      currentPermissionMode: "default",
    });
    registry.reserve(sessionId, {
      query: () => query,
    } as unknown as SessionController);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    const stale = runtime.setModel(sessionId, "older-model");
    const latest = runtime.setModel(sessionId, "newer-model");
    newerModel.resolve(undefined);
    await latest;
    expect(runtime.snapshot(sessionId).currentModel).toBe("newer-model");
    olderModel.resolve(undefined);
    await stale;
    expect(runtime.snapshot(sessionId).currentModel).toBe("newer-model");

    await runtime.setPermissionMode(sessionId, "acceptEdits");
    expect(runtime.snapshot(sessionId).currentPermissionMode).toBe("acceptEdits");
  });

  it("retains the previous control state when an SDK setter fails", async () => {
    const journal = new EventJournal({ epoch: "epoch-control-failure", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    vi.mocked(query.setModel).mockRejectedValue(new Error("setter failed"));
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, {
      currentModel: "initial-model",
      currentPermissionMode: "auto",
    });
    registry.reserve(sessionId, {
      query: () => query,
    } as unknown as SessionController);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    await expect(runtime.setModel(sessionId, "broken-model")).rejects.toThrow(
      "setter failed",
    );
    expect(runtime.snapshot(sessionId)).toMatchObject({
      currentModel: "initial-model",
      currentPermissionMode: "auto",
    });
  });

  it("keeps successful runtime fields when an optional capability fails", async () => {
    const journal = new EventJournal({ epoch: "epoch-runtime", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const runtimeState = new SessionRuntimeState({ journal });
    const controller = {
      query: () => query,
      refreshContext: async () => {
        runtimeState.merge(sessionId, {
          context: (await query.getContextUsage()) as unknown as Record<
            string,
            unknown
          >,
          contextStatus: "ready",
        });
      },
    } as unknown as SessionController;
    registry.reserve(sessionId, controller);
    const mcp = new McpService({
      journal,
      registry,
      restartSession: async () => undefined,
    });
    const refreshMetadata = vi.fn(async () => undefined);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp,
      refreshSessionMetadata: refreshMetadata,
    });

    await runtime.refresh(sessionId);

    expect(runtime.snapshot(sessionId)).toMatchObject({
      capabilities: ["background_tasks_v1"],
      models: [{ id: "performance" }],
      commands: [{ name: "help" }],
      agents: [{ name: "general" }],
      account: { email: "developer@example.com" },
      context: { totalTokens: 120 },
      contextStatus: "ready",
      credits: null,
      errors: [{
        code: "SDK_CAPABILITY_UNAVAILABLE",
        details: {
          provenance: "runtime-refresh",
          capability: "plugins",
        },
      }],
    });

    const app = Fastify();
    await registerRuntimeRoutes(app, {
      commandRunner: new CommandRunner({ journal }),
      runtime,
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/api/sessions/${sessionId}/model`,
      payload: { model: "performance" },
    });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(query.setModel).toHaveBeenCalledWith("performance"));

    const contextResponse = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/context/refresh`,
      payload: {},
    });
    expect(contextResponse.statusCode).toBe(202);
    await app.close();
  });

  it("correlates an explicit Context refresh failure to its accepted command", async () => {
    const journal = new EventJournal({ epoch: "epoch-runtime", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    vi.mocked(query.getContextUsage).mockRejectedValue(
      new Error("Context unavailable"),
    );
    const controller = {
      query: () => query,
      refreshContext: () => query.getContextUsage().then(() => undefined),
    } as unknown as SessionController;
    registry.reserve(sessionId, controller);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState: new SessionRuntimeState({ journal }),
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });
    const commandId = "00000000-0000-4000-8000-000000000912";
    const app = Fastify();
    await registerRuntimeRoutes(app, {
      commandRunner: new CommandRunner({
        journal,
        createUuid: () => commandId,
      }),
      runtime,
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/context/refresh`,
      payload: {},
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ commandId });
    await vi.waitFor(() => {
      const replay = journal.replay({ epoch: "epoch-runtime", after: 0 });
      expect(replay.kind).toBe("events");
      if (replay.kind !== "events") return;
      expect(replay.events).toContainEqual(
        expect.objectContaining({
          type: "command.failed",
          commandId,
          sessionId,
        }),
      );
    });
    await app.close();
  });

  it("projects only canonical directories accepted by the SDK", async () => {
    const acceptedDirectory = await mkdtemp(join(tmpdir(), "qoder-allowed-directory-"));
    const rejectedDirectory = await mkdtemp(join(tmpdir(), "qoder-rejected-directory-"));
    temporaryDirectories.push(acceptedDirectory, rejectedDirectory);
    const journal = new EventJournal({ epoch: "epoch-directories", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const canonicalAccepted = await realpath(acceptedDirectory);
    const canonicalRejected = await realpath(rejectedDirectory);
    vi.mocked(query.addDirectories).mockResolvedValue({
      added: [canonicalAccepted],
      failed: [{ path: canonicalRejected, error: "Directory rejected" }],
      directories: [canonicalAccepted],
    });
    const runtimeState = new SessionRuntimeState({ journal });
    registry.reserve(sessionId, {
      query: () => query,
    } as unknown as SessionController);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    await runtime.addDirectories(sessionId, [acceptedDirectory, rejectedDirectory]);

    expect(query.addDirectories).toHaveBeenCalledWith([
      canonicalAccepted,
      canonicalRejected,
    ]);
    expect(runtime.snapshot(sessionId).allowedDirectories).toEqual([
      canonicalAccepted,
    ]);
  });

  it("clears a transient MCP capability error after a successful refresh", async () => {
    const journal = new EventJournal({ epoch: "epoch-mcp-recovery", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    vi.mocked(query.mcpServerStatus)
      .mockRejectedValueOnce(new Error("MCP status unavailable"))
      .mockResolvedValueOnce([]);
    const runtimeState = new SessionRuntimeState({ journal });
    runtimeState.merge(sessionId, {
      errors: [
        {
          code: "SDK_CAPABILITY_UNAVAILABLE",
          message: "An unrelated same-code diagnostic remains current.",
          retryable: false,
        },
        {
          code: "SDK_CAPABILITY_UNAVAILABLE",
          message: "A differently owned same-code diagnostic remains current.",
          retryable: false,
          details: {
            provenance: "hook-runtime",
            capability: "mcp",
          },
        },
      ],
    });
    const controller = {
      query: () => query,
      refreshContext: async () => undefined,
    } as unknown as SessionController;
    registry.reserve(sessionId, controller);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    await runtime.refresh(sessionId);
    expect(runtime.snapshot(sessionId).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("MCP status"),
        }),
      ]),
    );

    await runtime.refresh(sessionId);
    expect(runtime.snapshot(sessionId).errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("MCP status"),
        }),
      ]),
    );
    expect(runtime.snapshot(sessionId).errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "An unrelated same-code diagnostic remains current.",
        }),
        expect.objectContaining({
          message: "A differently owned same-code diagnostic remains current.",
        }),
      ]),
    );
  });

  it("keeps the newer refresh when an older refresh fails later", async () => {
    const journal = new EventJournal({ epoch: "epoch-refresh-order", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const olderModels = deferred<
      Awaited<ReturnType<QueryPort["getAvailableModels"]>>
    >();
    const newerModel = {
      value: "newer-model",
      displayName: "Newer Model",
      description: "Newer Model fixture",
    };
    vi.mocked(query.getAvailableModels)
      .mockImplementationOnce(() => olderModels.promise)
      .mockResolvedValueOnce([newerModel]);
    vi.mocked(query.listPlugins).mockResolvedValue([]);
    const runtimeState = new SessionRuntimeState({ journal });
    registry.reserve(sessionId, {
      query: () => query,
      refreshContext: async () => undefined,
    } as unknown as SessionController);
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp: new McpService({
        journal,
        registry,
        restartSession: async () => undefined,
      }),
      refreshSessionMetadata: async () => undefined,
    });

    const olderRefresh = runtime.refresh(sessionId);
    const newerRefresh = runtime.refresh(sessionId);
    await newerRefresh;
    olderModels.reject(new Error("Older Model refresh failed"));
    await olderRefresh;

    expect(runtime.snapshot(sessionId).models).toEqual([newerModel]);
    expect(runtime.snapshot(sessionId).errors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: {
            provenance: "runtime-refresh",
            capability: "models",
          },
        }),
      ]),
    );
  });

  it("does not commit an older MCP preflight after a newer refresh", async () => {
    const journal = new EventJournal({ epoch: "epoch-mcp-refresh-order", capacity: 100 });
    const registry = new SessionRegistry();
    const query = fakeQuery();
    const olderStatuses = deferred<
      Awaited<ReturnType<QueryPort["mcpServerStatus"]>>
    >();
    vi.mocked(query.mcpServerStatus)
      .mockImplementationOnce(() => olderStatuses.promise)
      .mockResolvedValueOnce([{ name: "github", status: "connected" }]);
    vi.mocked(query.listPlugins).mockResolvedValue([]);
    const runtimeState = new SessionRuntimeState({ journal });
    registry.reserve(sessionId, {
      query: () => query,
      refreshContext: async () => undefined,
    } as unknown as SessionController);
    const mcp = new McpService({
      journal,
      registry,
      restartSession: async () => undefined,
    });
    const runtime = new RuntimeCapabilityService({
      journal,
      registry,
      runtimeState,
      mcp,
      refreshSessionMetadata: async () => undefined,
    });

    const olderRefresh = runtime.refresh(sessionId);
    const newerRefresh = runtime.refresh(sessionId);
    await newerRefresh;
    expect(mcp.snapshot()).toMatchObject([
      { sessionId, name: "github", status: "connected" },
    ]);
    expect(() => mcp.requireReady(sessionId)).not.toThrow();
    const cursorAfterNewer = journal.cursor();

    olderStatuses.resolve([
      { name: "github", status: "needs-auth" },
    ]);
    await olderRefresh;

    expect(mcp.snapshot()).toMatchObject([
      { sessionId, name: "github", status: "connected" },
    ]);
    expect(() => mcp.requireReady(sessionId)).not.toThrow();
    expect(journal.cursor()).toBe(cursorAfterNewer);
  });
});
