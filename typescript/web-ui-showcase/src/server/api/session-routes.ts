import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commandAcceptedSchema,
  emptyCommandSchema,
  forkSessionCommandSchema,
  renameSessionCommandSchema,
  sendMessageCommandSchema,
  sessionStartedSchema,
  startSessionCommandSchema,
  tagSessionCommandSchema,
} from "../../shared/commands.js";
import { messageIdSchema, sessionIdSchema } from "../../shared/ids.js";
import {
  appSnapshotSchema,
} from "../../shared/snapshots.js";
import { subagentTranscriptResponseSchema } from "../../shared/subagents.js";
import type { SessionCatalog } from "../services/session-catalog-port.js";
import type { SessionService } from "../services/session-service.js";
import type { SessionStartService } from "../services/session-start-service.js";
import type { SnapshotService } from "../services/snapshot-service.js";
import { SubagentTranscriptService } from "../services/subagent-transcript-service.js";
import type { CommandRunner } from "./command-runner.js";

const sessionParamsSchema = z
  .object({ sessionId: sessionIdSchema })
  .strict();
const messageParamsSchema = z
  .object({
    sessionId: sessionIdSchema,
    messageUuid: messageIdSchema,
  })
  .strict();
const snapshotQuerySchema = z
  .object({ sessionId: sessionIdSchema.optional() })
  .strict();
const subagentToolParamsSchema = z
  .object({
    sessionId: sessionIdSchema,
    toolUseId: z.string().trim().min(1).max(500),
  })
  .strict();

function emptyBody(value: unknown): void {
  emptyCommandSchema.parse(value ?? {});
}

/** Registers durable Session commands and the diagnostic snapshot endpoint. */
export async function registerSessionRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    sessionService: SessionService;
    sessionStarts: SessionStartService;
    snapshotService: SnapshotService;
    sessionCatalog: SessionCatalog;
  },
): Promise<void> {
  const subagentTranscripts = new SubagentTranscriptService({
    catalog: options.sessionCatalog,
  });
  app.get("/api/snapshot", async (request) => {
    const query = snapshotQuerySchema.parse(request.query);
    return appSnapshotSchema.parse(
      await options.snapshotService.snapshot(query.sessionId),
    );
  });

  app.post("/api/sessions/start", async (request, reply) => {
    const input = startSessionCommandSchema.parse(request.body);
    return reply.code(201).send(
      sessionStartedSchema.parse(await options.sessionStarts.start(input)),
    );
  });

  app.get(
    "/api/sessions/:sessionId/subagents/by-tool/:toolUseId",
    async (request) => {
      const { sessionId, toolUseId } = subagentToolParamsSchema.parse(
        request.params,
      );
      const session = options.sessionService.requireSession(sessionId);
      return subagentTranscriptResponseSchema.parse(
        await subagentTranscripts.resolve(session.cwd, sessionId, toolUseId),
      );
    },
  );

  app.post("/api/sessions/:sessionId/ensure", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    emptyBody(request.body);
    options.sessionService.requireSession(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.ensureAvailable(sessionId),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.post("/api/sessions/:sessionId/messages", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const body = sendMessageCommandSchema.parse(request.body);
    options.sessionService.requireLive(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: async () => options.sessionService.send(sessionId, body),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.delete(
    "/api/sessions/:sessionId/messages/:messageUuid",
    async (request, reply) => {
      const { sessionId, messageUuid } = messageParamsSchema.parse(
        request.params,
      );
      options.sessionService.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () =>
          options.sessionService.cancelMessage(sessionId, messageUuid),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post("/api/sessions/:sessionId/interrupt", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    emptyBody(request.body);
    options.sessionService.requireLive(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.interrupt(sessionId),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.patch("/api/sessions/:sessionId/title", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { title } = renameSessionCommandSchema.parse(request.body);
    options.sessionService.requireSession(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.rename(sessionId, title),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.patch("/api/sessions/:sessionId/tag", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { tag } = tagSessionCommandSchema.parse(request.body);
    options.sessionService.requireSession(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.tag(sessionId, tag),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.post("/api/sessions/:sessionId/fork", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const body = forkSessionCommandSchema.parse(request.body ?? {});
    options.sessionService.requireSession(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.fork(sessionId, body).then(() => undefined),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.delete("/api/sessions/:sessionId", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    options.sessionService.requireSession(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.sessionService.delete(sessionId),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });
}
