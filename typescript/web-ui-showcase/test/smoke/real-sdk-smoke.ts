import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../../src/server/config.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { InputQueue } from "../../src/server/sdk/input-queue.js";
import { InteractionBroker } from "../../src/server/sdk/interaction-broker.js";
import { createQueryFactory } from "../../src/server/sdk/query-factory.js";
import type { QueryPort } from "../../src/server/sdk/query-port.js";
import { createSessionCatalog } from "../../src/server/sdk/session-catalog.js";

const skipMessage =
  "SKIP real SDK smoke: configure qodercli authentication or QODER_PERSONAL_ACCESS_TOKEN.";

function authNotConfigured(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; message?: unknown; cause?: unknown };
  return (
    value.code === "auth_not_configured" ||
    (typeof value.message === "string" &&
      value.message.toLowerCase().includes("auth_not_configured")) ||
    authNotConfigured(value.cause)
  );
}

const authMode =
  process.env.QODER_WEBUI_AUTH === "access-token" ? "access-token" : "cli";
if (
  authMode === "access-token" &&
  (process.env.QODER_PERSONAL_ACCESS_TOKEN?.trim().length ?? 0) === 0
) {
  console.log(skipMessage);
  process.exit(0);
}

const project = await realpath(
  await mkdtemp(join(tmpdir(), "qoder-webui-real-smoke-")),
);
await writeFile(
  join(project, "README.md"),
  "# Qoder Agent SDK Web UI real smoke fixture\n",
  "utf8",
);
const sessionId = randomUUID();
const config: ServerConfig = {
  host: "127.0.0.1",
  port: 8787,
  assetRoot: null,
  dataDirectory: join(project, ".app-data"),
  authMode,
  model: process.env.QODER_WEBUI_MODEL?.trim() || "auto",
  permissionMode: "default",
  eventCapacity: 100,
  enableCheckpoints: true,
  rawEvents: false,
  devOrigin: "http://127.0.0.1:5173",
  allowedOrigins: new Set(["http://127.0.0.1:5173"]),
};
const journal = new EventJournal({ epoch: randomUUID(), capacity: 100 });
const interactions = new InteractionBroker({ journal });
const queryFactory = createQueryFactory({ config });
const catalog = createSessionCatalog();
let activeQuery: QueryPort | undefined;
let resultSessionId: string = sessionId;

async function initialize(input: InputQueue, resume: boolean): Promise<QueryPort> {
  const query = queryFactory.create({
    workspacePath: project,
    input,
    interactions,
    getSessionId: () => sessionId,
    mcpServers: {},
    hooks: {},
    ...(resume ? { resumeSessionId: sessionId } : { newSessionId: sessionId }),
  });
  activeQuery = query;
  await query.initializationResult();
  return query;
}

try {
  const input = new InputQueue();
  const query = await initialize(input, false);
  input.enqueue({
    text: "Reply with exactly WEB_UI_SMOKE_OK.",
    priority: "next",
    shouldQuery: true,
  });
  let succeeded = false;
  for await (const message of query) {
    if (
      message.type === "result" &&
      message.subtype === "success" &&
      message.result.includes("WEB_UI_SMOKE_OK")
    ) {
      resultSessionId = message.session_id;
      succeeded = true;
      break;
    }
    if (message.type === "result" && message.subtype !== "success") {
      throw new Error(`Real SDK smoke failed with result subtype ${message.subtype}.`);
    }
  }
  if (!succeeded) throw new Error("Real SDK smoke ended without the expected marker.");
  await query.close();
  activeQuery = undefined;

  if (resultSessionId !== sessionId) {
    throw new Error("Real SDK smoke returned a different Session identifier than requested.");
  }
  let session = await catalog.get(project, sessionId);
  let history = await catalog.messages(project, sessionId);
  for (let attempt = 0; attempt < 50 && (session === undefined || history.length === 0); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    session = await catalog.get(project, sessionId);
    history = await catalog.messages(project, sessionId);
  }
  if (session === undefined || history.length === 0) {
    throw new Error(
      `Real SDK smoke Session persistence incomplete (metadata=${String(session !== undefined)}, messages=${history.length}).`,
    );
  }

  const resumed = await initialize(new InputQueue(), true);
  await resumed.close();
  activeQuery = undefined;
  console.log("PASS real SDK smoke: create, persist, resume, and close.");
} catch (error) {
  if (authNotConfigured(error)) {
    console.log(skipMessage);
  } else {
    throw error;
  }
} finally {
  await activeQuery?.close().catch(() => undefined);
  await catalog.delete(project, sessionId).catch(() => undefined);
  await rm(project, { recursive: true, force: true });
}
