import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addDirectoriesCommandSchema,
  backgroundTasksCommandSchema,
  commandAcceptedSchema,
  emptyCommandSchema,
  generateTitleCommandSchema,
  setModelCommandSchema,
  setPermissionModeCommandSchema,
} from "../../shared/commands.js";
import { sessionIdSchema } from "../../shared/ids.js";
import type { RuntimeCapabilityService } from "../sdk/runtime-capability-service.js";
import type { CommandRunner } from "./command-runner.js";

const sessionParamsSchema = z
  .object({ sessionId: sessionIdSchema })
  .strict();
const taskParamsSchema = z
  .object({
    sessionId: sessionIdSchema,
    taskId: z.string().trim().min(1).max(500),
  })
  .strict();

/** Registers accepted commands for the released Query control surface. */
export async function registerRuntimeRoutes(
  app: FastifyInstance,
  options: {
    commandRunner: CommandRunner;
    runtime: RuntimeCapabilityService;
  },
): Promise<void> {
  app.patch("/api/sessions/:sessionId/model", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { model } = setModelCommandSchema.parse(request.body);
    options.runtime.requireLive(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.runtime.setModel(sessionId, model),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.patch(
    "/api/sessions/:sessionId/permission-mode",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { permissionMode } = setPermissionModeCommandSchema.parse(
        request.body,
      );
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () =>
          options.runtime.setPermissionMode(sessionId, permissionMode),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post("/api/sessions/:sessionId/directories", async (request, reply) => {
    const { sessionId } = sessionParamsSchema.parse(request.params);
    const { directories } = addDirectoriesCommandSchema.parse(request.body);
    options.runtime.requireLive(sessionId);
    const accepted = options.commandRunner.accept({
      sessionId,
      execute: () => options.runtime.addDirectories(sessionId, directories),
    });
    return reply.code(202).send(commandAcceptedSchema.parse(accepted));
  });

  app.post(
    "/api/sessions/:sessionId/directories/pick",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.pickAndAddDirectory(sessionId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/tasks/:taskId/stop",
    async (request, reply) => {
      const { sessionId, taskId } = taskParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.stopTask(sessionId, taskId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/tasks/background",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { toolUseId } = backgroundTasksCommandSchema.parse(
        request.body ?? {},
      );
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.backgroundTasks(sessionId, toolUseId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/runtime/refresh",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.refresh(sessionId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/context/refresh",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.refreshContext(sessionId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/plugins/reload",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      emptyCommandSchema.parse(request.body ?? {});
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.reloadPlugins(sessionId),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );

  app.post(
    "/api/sessions/:sessionId/title/generate",
    async (request, reply) => {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { description } = generateTitleCommandSchema.parse(request.body);
      options.runtime.requireLive(sessionId);
      const accepted = options.commandRunner.accept({
        sessionId,
        execute: () => options.runtime.generateTitle(sessionId, description),
      });
      return reply.code(202).send(commandAcceptedSchema.parse(accepted));
    },
  );
}
