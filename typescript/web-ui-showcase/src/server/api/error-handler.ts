import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError, toWireError } from "../errors/app-error.js";

type StatusError = Error & { statusCode?: number; code?: string };

/** Installs one safe HTTP error projection for parser, validation, and app failures. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: StatusError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send(toWireError(error));
    }
    if (
      error instanceof ZodError ||
      error.statusCode === 400 ||
      error.code?.startsWith("FST_ERR_CTP_") === true
    ) {
      return reply.code(400).send({
        code: "REQUEST_INVALID",
        message: "The request did not match the expected command format.",
        retryable: false,
      });
    }
    request.log.error(
      { errorClass: "unhandled-request", requestId: request.id },
      "Unhandled local Web UI request error",
    );
    return reply.code(500).send({
      code: "INTERNAL_ERROR",
      message: "The local server could not complete the request.",
      retryable: false,
    });
  });
}
