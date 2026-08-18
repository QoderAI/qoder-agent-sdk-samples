import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commandAcceptedSchema,
  emptyCommandSchema,
  mcpOAuthCallbackCommandSchema,
} from "../../shared/commands.js";
import { sessionIdSchema } from "../../shared/ids.js";
import type { McpService } from "../sdk/mcp-service.js";
import type { SessionService } from "../services/session-service.js";
import type { CommandRunner } from "./command-runner.js";

const mcpParamsSchema = z
  .object({
    sessionId: sessionIdSchema,
    serverName: z.string().trim().min(1).max(200),
  })
  .strict();

/** Registers public MCP authentication and restart-based reconnect commands. */
export async function registerMcpRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    mcp: McpService;
    sessions: SessionService;
  },
): Promise<void> {
  app.post(
    "/api/sessions/:sessionId/mcp/:serverName/authenticate",
    async (request, reply) => {
      const { sessionId, serverName } = mcpParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.sessions.requireLive(sessionId);
      options.mcp.requireServer(sessionId, serverName);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.mcp.authenticate(sessionId, serverName),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/mcp/:serverName/oauth-callback",
    async (request, reply) => {
      const { sessionId, serverName } = mcpParamsSchema.parse(request.params);
      const { callbackUrl } = mcpOAuthCallbackCommandSchema.parse(request.body);
      options.sessions.requireLive(sessionId);
      options.mcp.requireServer(sessionId, serverName);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () =>
          options.mcp.submitCallback(sessionId, serverName, callbackUrl),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/mcp/:serverName/reconnect",
    async (request, reply) => {
      const { sessionId, serverName } = mcpParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.sessions.requireLive(sessionId);
      options.mcp.requireServer(sessionId, serverName);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.mcp.reconnect(sessionId, serverName),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );
}
