import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { AppSnapshot } from "../shared/snapshots.js";
import { CommandRunner } from "./api/command-runner.js";
import { registerErrorHandler } from "./api/error-handler.js";
import { registerCheckpointRoutes } from "./api/checkpoint-routes.js";
import { registerInteractionRoutes } from "./api/interaction-routes.js";
import { registerMcpRoutes } from "./api/mcp-routes.js";
import { registerRuntimeRoutes } from "./api/runtime-routes.js";
import { registerSessionRoutes } from "./api/session-routes.js";
import { registerWorkspaceRoutes } from "./api/workspace-routes.js";
import { registerWorkspaceFileRoutes } from "./api/workspace-file-routes.js";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { AppError } from "./errors/app-error.js";
import type { DirectoryPicker } from "./platform/directory-picker.js";
import {
  createNativeDirectoryPicker,
  createSpawnCommandExecutor,
} from "./platform/native-directory-picker.js";
import {
  createJsonWorkspaceRepository,
  type WorkspaceRepository,
} from "./persistence/workspace-repository.js";
import { EventJournal } from "./realtime/event-journal.js";
import { registerRealtimeHub } from "./realtime/realtime-hub.js";
import { InteractionBroker } from "./sdk/interaction-broker.js";
import { createShowcaseHooks } from "./sdk/hooks.js";
import { CheckpointService } from "./sdk/checkpoint-service.js";
import { SessionRuntimeState } from "./sdk/session-runtime-state.js";
import {
  createMcpServers,
  loadRemoteMcpServers,
} from "./sdk/mcp-config.js";
import { McpService } from "./sdk/mcp-service.js";
import { RuntimeCapabilityService } from "./sdk/runtime-capability-service.js";
import {
  createQueryFactory,
  type QueryFactory,
} from "./sdk/query-factory.js";
import {
  createSessionCatalog,
} from "./sdk/session-catalog.js";
import { SessionRegistry } from "./sdk/session-registry.js";
import type { SessionCatalog } from "./services/session-catalog-port.js";
import { SessionService } from "./services/session-service.js";
import { SessionStartService } from "./services/session-start-service.js";
import { SnapshotService } from "./services/snapshot-service.js";
import { WorkspaceService } from "./services/workspace-service.js";
import { WorkspaceFileService } from "./services/workspace-file-service.js";

export type CreateAppOptions = {
  assetRoot: string | null;
  journal?: EventJournal;
  getSnapshot?: (sessionId?: string) => AppSnapshot | Promise<AppSnapshot>;
  allowedOrigins?: ReadonlySet<string>;
  allowMissingOriginForTests?: boolean;
  workspaceRepository?: WorkspaceRepository;
  directoryPicker?: DirectoryPicker;
  dataDirectory?: string;
  config?: ServerConfig;
  sessionCatalog?: SessionCatalog;
  queryFactory?: QueryFactory;
  sessionRegistry?: SessionRegistry;
  interactionBroker?: InteractionBroker;
  runtimeState?: SessionRuntimeState;
};

export async function createApp(
  options: CreateAppOptions,
): Promise<FastifyInstance> {
  const config = options.config ?? loadServerConfig();
  const app = Fastify({
    logger: {
      level: process.env.QODER_WEBUI_LOG_LEVEL ?? "warn",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body.callbackUrl",
        "req.body.access_token",
        "req.body.refresh_token",
        "req.body.apiKey",
      ],
    },
  });
  const journal =
    options.journal ??
    new EventJournal({
      epoch: randomUUID(),
      capacity: config.eventCapacity,
    });
  const dataDirectory =
    options.dataDirectory ??
    process.env.QODER_WEBUI_DATA_DIR ??
    join(homedir(), ".qoder-agent-sdk-web-ui-showcase");
  const workspaceRepository =
    options.workspaceRepository ??
    createJsonWorkspaceRepository(join(dataDirectory, "workspaces.json"));
  const directoryPicker =
    options.directoryPicker ??
    createNativeDirectoryPicker({
      platform: process.platform,
      executor: createSpawnCommandExecutor(),
    });
  const workspaceService = new WorkspaceService({
    repository: workspaceRepository,
    picker: directoryPicker,
    journal,
  });
  const commandRunner = new CommandRunner({ journal });
  const sessionCatalog = options.sessionCatalog ?? createSessionCatalog();
  const queryFactory =
    options.queryFactory ?? createQueryFactory({ config });
  const sessionRegistry = options.sessionRegistry ?? new SessionRegistry();
  const interactions =
    options.interactionBroker ?? new InteractionBroker({ journal });
  const sessionRuntime =
    options.runtimeState ?? new SessionRuntimeState({ journal });
  const allowedOrigins = options.allowedOrigins ?? config.allowedOrigins;
  const remoteMcpServers = await loadRemoteMcpServers(
    config.mcpConfigFile,
  );
  const snapshotService = new SnapshotService({
    workspaceService,
    sessionCatalog,
    journal,
  });
  await snapshotService.hydrate();
  let sessionService: SessionService | undefined;
  const mcp = new McpService({
    journal,
    registry: sessionRegistry,
    restartSession: (sessionId) => {
      if (sessionService === undefined) {
        throw new AppError({
          code: "SERVER_NOT_READY",
          message: "The local server is still starting.",
          status: 503,
          retryable: true,
        });
      }
      return sessionService.restartForMcp(sessionId);
    },
  });
  const checkpoints = new CheckpointService({
    registry: sessionRegistry,
    catalog: sessionCatalog,
    journal,
    getSession: (sessionId) => snapshotService.session(sessionId),
  });
  sessionService = new SessionService({
    catalog: sessionCatalog,
    queryFactory,
    registry: sessionRegistry,
    interactions,
    journal,
    snapshots: snapshotService,
    mcp,
    runtimeState: sessionRuntime,
    defaultModel: config.model,
    defaultPermissionMode: config.permissionMode,
    withWorkspace: (workspaceId, operation) =>
      workspaceService.withWorkspace(workspaceId, operation),
    clearCheckpoints: (sessionId) => checkpoints.clearSession(sessionId),
    includeRawEvents: config.rawEvents,
    mcpServersForWorkspace: (workspacePath) =>
      createMcpServers(workspacePath, remoteMcpServers),
    hooksForSession: (getSessionId) =>
      createShowcaseHooks({
        sessionId: getSessionId,
        runtimeState: sessionRuntime,
        onToolRunning: (toolUseId) =>
          sessionRegistry.get(getSessionId())?.markToolRunning(toolUseId),
      }),
  });
  const sessionStarts = new SessionStartService({
    workspaces: workspaceService,
    sessions: sessionService,
  });
  const runtime = new RuntimeCapabilityService({
    journal,
    registry: sessionRegistry,
    runtimeState: sessionRuntime,
    mcp,
    refreshSessionMetadata: (sessionId, title) =>
      sessionService?.refreshMetadata(sessionId, title) ?? Promise.resolve(),
    includeRawEvents: config.rawEvents,
  });
  const workspaceFiles = new WorkspaceFileService({
    workspaces: workspaceService,
    resolveSession: async (sessionId) => {
      if (sessionService === undefined) {
        throw new AppError({
          code: "SERVER_NOT_READY",
          message: "The local server is still starting.",
          status: 503,
          retryable: true,
        });
      }
      const session = sessionService.requireSession(sessionId);
      return {
        workspaceId: session.workspaceId,
        allowedDirectories:
          runtime.snapshot(sessionId).allowedDirectories ?? [],
      };
    },
  });
  const getSnapshot =
    options.getSnapshot ??
    ((sessionId?: string) => snapshotService.snapshot(sessionId));

  registerErrorHandler(app);

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/api/")) return;
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      throw new AppError({
        code: "ORIGIN_NOT_ALLOWED",
        message: "The browser Origin is not allowed to access this local API.",
        status: 403,
        retryable: false,
      });
    }
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    void reply
      .header(
        "Content-Security-Policy",
        "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
      )
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    return payload;
  });

  await registerRealtimeHub(app, {
    journal,
    getSnapshot,
    allowedOrigins,
    ...(options.allowMissingOriginForTests === undefined
      ? {}
      : { allowMissingOriginForTests: options.allowMissingOriginForTests }),
  });
  await registerWorkspaceRoutes(app, {
    commandRunner,
    workspaceService,
    removeWorkspace: (workspaceId, commandId) =>
      workspaceService.remove(workspaceId, commandId, (workspace) =>
        sessionService.deleteWorkspaceSessions(workspace)),
  });
  await registerWorkspaceFileRoutes(app, { workspaceFiles });
  await registerSessionRoutes(app, {
    commandRunner,
    sessionService,
    sessionStarts,
    snapshotService,
    sessionCatalog,
  });
  await registerInteractionRoutes(app, {
    commandRunner,
    interactions,
  });
  await registerMcpRoutes(app, {
    commandRunner,
    mcp,
    sessions: sessionService,
  });
  await registerRuntimeRoutes(app, { commandRunner, runtime });
  await registerCheckpointRoutes(app, { commandRunner, checkpoints });

  app.get("/api/health", async () => ({
    name: "qoder-agent-sdk-web-ui-showcase",
    status: "ok" as const,
  }));

  if (options.assetRoot !== null) {
    await app.register(fastifyStatic, {
      root: options.assetRoot,
      wildcard: false,
    });
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) {
        return reply.code(404).send({
          code: "ROUTE_NOT_FOUND",
          message: "The requested local endpoint does not exist.",
          retryable: false,
        });
      }
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    try {
      await sessionRegistry.closeAll("Local Web UI server stopped.");
    } finally {
      try {
        snapshotService.close();
      } finally {
        sessionRuntime.close();
      }
    }
  });

  return app;
}
