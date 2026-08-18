import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commandAcceptedSchema,
  interactionResponseSchema,
} from "../../shared/commands.js";
import { interactionIdSchema } from "../../shared/ids.js";
import { AppError } from "../errors/app-error.js";
import type { InteractionBroker } from "../sdk/interaction-broker.js";
import type { CommandRunner } from "./command-runner.js";

const interactionParamsSchema = z
  .object({ interactionId: interactionIdSchema })
  .strict();

/** Registers responses for approvals, questions, and MCP elicitation. */
export async function registerInteractionRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    interactions: InteractionBroker;
  },
): Promise<void> {
  app.post(
    "/api/interactions/:interactionId/respond",
    async (request, reply) => {
      const { interactionId } = interactionParamsSchema.parse(request.params);
      const response = interactionResponseSchema.parse(request.body);
      const pending = options.interactions
        .pending()
        .find((interaction) => interaction.id === interactionId);
      if (pending === undefined) {
        throw new AppError({
          code: "INTERACTION_NOT_PENDING",
          message: "This interaction has already been resolved.",
          status: 409,
          retryable: false,
        });
      }
      options.interactions.validateResponse(interactionId, response);
      const accepted = options.commandRunner.accept({
        sessionId: pending.sessionId,
        execute: async (commandId) =>
          options.interactions.respond(interactionId, response, commandId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );
}
