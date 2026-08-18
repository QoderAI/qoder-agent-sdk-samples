import { createApp } from "./app.js";
import { loadServerConfig } from "./config.js";
import { createShutdown } from "./shutdown.js";

const config = loadServerConfig();
const app = await createApp({
  assetRoot: config.assetRoot,
  dataDirectory: config.dataDirectory,
  config,
});

await app.listen({ host: config.host, port: config.port });
const shutdown = createShutdown(app);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
