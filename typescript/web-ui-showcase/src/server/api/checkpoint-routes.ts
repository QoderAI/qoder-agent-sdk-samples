import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  checkpointExecuteCommandSchema,
  checkpointPreviewCommandSchema,
  commandAcceptedSchema,
} from "../../shared/commands.js";
import { sessionIdSchema } from "../../shared/ids.js";
import type { CheckpointService } from "../sdk/checkpoint-service.js";
import type { CommandRunner } from "./command-runner.js";

const sessionParamsSchema = z
  .object({ sessionId: sessionIdSchema })
  .strict();

/** Registers preview-first file and conversation rewind commands. */
export async function registerCheckpointRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    checkpoints: CheckpointService;
  },
): Promise<void> {
  app.post(
    "/api/sessions/:sessionId/checkpoints/preview",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const body = checkpointPreviewCommandSchema.parse(request.body);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.checkpoints.preview(sessionId, body).then(() => undefined),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/checkpoints/execute",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const body = checkpointExecuteCommandSchema.parse(request.body);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.checkpoints.execute(sessionId, body),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );
}
