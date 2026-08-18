import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commandAcceptedSchema,
  registerWorkspaceCommandSchema,
} from "../../shared/commands.js";
import { workspaceIdSchema } from "../../shared/ids.js";
import type { WorkspaceService } from "../services/workspace-service.js";
import type { CommandRunner } from "./command-runner.js";

const workspaceParamsSchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict();

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    workspaceService: WorkspaceService;
    removeWorkspace: (workspaceId: string, commandId: string) => Promise<void>;
  },
): Promise<void> {
  app.post("/api/workspaces", async (request, reply) => {
    const body = registerWorkspaceCommandSchema.parse(request.body);
    const accepted = options.commandRunner.accept({
      execute: (commandId) =>
        options.workspaceService.register(body.path, commandId).then(() => undefined),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.post("/api/workspaces/pick", async (_request, reply) => {
    const accepted = options.commandRunner.accept({
      execute: (commandId) =>
        options.workspaceService
          .pickAndRegister(commandId)
          .then(() => undefined),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.delete("/api/workspaces/:workspaceId", async (request, reply) => {
    const { workspaceId } = workspaceParamsSchema.parse(request.params);
    const accepted = options.commandRunner.accept({
      execute: (commandId) =>
        options.removeWorkspace(workspaceId, commandId),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });
}
