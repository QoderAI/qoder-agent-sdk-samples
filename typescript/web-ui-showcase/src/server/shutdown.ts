import type { FastifyInstance } from "fastify";

/** Creates an idempotent shutdown operation for signal handlers and tests. */
export function createShutdown(
  app: FastifyInstance,
  announce: (message: string) => void = console.info,
): (signal: string) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  return (signal) => {
    if (shutdownPromise === undefined) {
      announce(`Stopping local Web UI after ${signal}.`);
      shutdownPromise = app.close();
    }
    return shutdownPromise;
  };
}
