import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sessionIdSchema } from "../../shared/ids.js";
import {
  workspaceFileQuerySchema,
  workspaceFileSearchResultSchema,
} from "../../shared/workspace-files.js";
import type { WorkspaceFileService } from "../services/workspace-file-service.js";

const sessionParamsSchema = z
  .object({
    sessionId: sessionIdSchema,
  })
  .strict();

export async function registerWorkspaceFileRoutes(
  app: FastifyInstance,
  options: { workspaceFiles: WorkspaceFileService },
): Promise<void> {
  app.get("/api/sessions/:sessionId/files", async (request, reply) => {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    request.raw.once("aborted", abort);
    reply.raw.once("close", abort);
    try {
      const { sessionId } = sessionParamsSchema.parse(request.params);
      const { q } = workspaceFileQuerySchema.parse(request.query);
      return workspaceFileSearchResultSchema.parse(
        await options.workspaceFiles.search(sessionId, q, controller.signal),
      );
    } finally {
      request.raw.off("aborted", abort);
      reply.raw.off("close", abort);
    }
  });
}
