import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../src/server/app.js";
import type { ServerConfig } from "../../src/server/config.js";
import { createFakeQueryFactory } from "../fixtures/fake-query.js";
import {
  FixtureSessionCatalog,
  FixtureWorkspaceRepository,
} from "../fixtures/fake-sdk-runtime.js";

const host = "127.0.0.1";
const port = Number(process.env.QODER_WEBUI_PORT ?? "4178");
const fixtureProject = await mkdtemp(join(tmpdir(), "qoder-webui-fixture-"));
await writeFile(
  join(fixtureProject, "README.md"),
  "# Deterministic Qoder Web UI fixture\n",
  "utf8",
);

const catalog = new FixtureSessionCatalog();
const config: ServerConfig = {
  host,
  port,
  assetRoot: resolve("dist/client"),
  dataDirectory: join(fixtureProject, ".app-data"),
  authMode: "cli",
  model: "fixture-model",
  permissionMode: "default",
  eventCapacity: 1_000,
  enableCheckpoints: true,
  rawEvents: true,
  allowedOrigins: new Set([`http://${host}:${port}`]),
};
const app = await createApp({
  assetRoot: config.assetRoot,
  config,
  workspaceRepository: new FixtureWorkspaceRepository(),
  directoryPicker: { pick: async () => fixtureProject },
  sessionCatalog: catalog,
  queryFactory: createFakeQueryFactory(catalog),
  allowedOrigins: config.allowedOrigins,
});

app.get("/__test/runtime", async () => ({ kind: "deterministic-query-port" }));
app.get<{ Params: { sessionId: string } }>(
  "/__test/elicitation/:sessionId",
  async (request) => ({
    content: catalog.elicitation(request.params.sessionId) ?? null,
  }),
);
await app.listen({ host, port });

let shutdownPromise: Promise<void> | undefined;
function shutdown(): Promise<void> {
  shutdownPromise ??= app
    .close()
    .finally(() => rm(fixtureProject, { recursive: true, force: true }));
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
}
