import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  deleteSession,
  getSessionInfo,
  query,
  type SDKResultSuccess,
  type SessionKey,
  type SessionStore,
  type SessionStoreEntry,
} from "@qoder-ai/qoder-agent-sdk";
import { Redis } from "ioredis";

const MAIN_TRANSCRIPT = "main";

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

async function execute(
  transaction: ReturnType<Redis["multi"]>,
): Promise<void> {
  const results = await transaction.exec();
  if (results === null) {
    throw new Error("The Redis transaction was discarded.");
  }
  for (const [error] of results) {
    if (error) throw error;
  }
}

/**
 * Redis reference adapter.
 *
 * Lists hold transcript entries in append order. A sorted set indexes main
 * sessions by modification time, and a set indexes child transcript paths.
 */
export class RedisSessionStore implements SessionStore {
  private readonly prefix: string;

  constructor(
    private readonly client: Redis,
    prefix = "qoder:samples:session-storage",
  ) {
    this.prefix = prefix.replace(/:+$/, "");
  }

  async append(
    key: SessionKey,
    entries: SessionStoreEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const transaction = this.client.multi();
    transaction.rpush(
      this.entriesKey(key),
      ...entries.map((entry) => JSON.stringify(entry)),
    );
    if (key.subpath === undefined) {
      transaction.zadd(
        this.sessionsKey(key.projectKey),
        Date.now(),
        key.sessionId,
      );
    } else {
      transaction.sadd(this.subkeysKey(key), key.subpath);
    }
    await execute(transaction);
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const values = await this.client.lrange(this.entriesKey(key), 0, -1);
    if (values.length === 0) return null;
    return values.map((value) => JSON.parse(value) as SessionStoreEntry);
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const values = await this.client.zrevrange(
      this.sessionsKey(projectKey),
      0,
      -1,
      "WITHSCORES",
    );
    const sessions: Array<{ sessionId: string; mtime: number }> = [];
    for (let index = 0; index < values.length; index += 2) {
      sessions.push({
        sessionId: values[index]!,
        mtime: Number(values[index + 1]),
      });
    }
    return sessions;
  }

  async listSubkeys(
    key: Omit<SessionKey, "subpath">,
  ): Promise<string[]> {
    return (await this.client.smembers(this.subkeysKey(key))).sort();
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath !== undefined) {
      const transaction = this.client
        .multi()
        .del(this.entriesKey(key))
        .srem(this.subkeysKey(key), key.subpath);
      await execute(transaction);
      return;
    }

    const subpaths = await this.client.smembers(this.subkeysKey(key));
    const childKeys = subpaths.map((subpath) =>
      this.entriesKey({ ...key, subpath }),
    );
    const transaction = this.client
      .multi()
      .del(this.entriesKey(key), this.subkeysKey(key), ...childKeys)
      .zrem(this.sessionsKey(key.projectKey), key.sessionId);
    await execute(transaction);
  }

  private entriesKey(key: SessionKey): string {
    const transcript = key.subpath !== undefined
      ? `child:${encoded(key.subpath)}`
      : MAIN_TRANSCRIPT;
    return [
      this.prefix,
      "entries",
      encoded(key.projectKey),
      encoded(key.sessionId),
      transcript,
    ].join(":");
  }

  private sessionsKey(projectKey: string): string {
    return [this.prefix, "sessions", encoded(projectKey)].join(":");
  }

  private subkeysKey(key: Omit<SessionKey, "subpath">): string {
    return [
      this.prefix,
      "subkeys",
      encoded(key.projectKey),
      encoded(key.sessionId),
    ].join(":");
  }
}

async function runQuery(options: {
  workspace: string;
  prompt: string;
  store: SessionStore;
  resume?: string;
}): Promise<SDKResultSuccess> {
  const stream = query({
    prompt: options.prompt,
    options: {
      auth: accessTokenFromEnv(),
      cwd: options.workspace,
      tools: [],
      maxTurns: 1,
      model: "auto",
      sessionStore: options.store,
      ...(options.resume ? { resume: options.resume } : {}),
    },
  });

  let result: SDKResultSuccess | undefined;
  try {
    for await (const message of stream) {
      if (message.type === "system" && message.subtype === "mirror_error") {
        throw new Error(
          `SessionStore could not persist ${JSON.stringify(message.key)}: ${message.error}`,
        );
      }
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new Error(message.errors?.join("\n") || message.subtype);
        }
        result = message;
      }
    }
  } finally {
    await stream.close();
  }

  if (!result) throw new Error("The query ended without a success result.");
  return result;
}

export async function run(workspace: string): Promise<void> {
  const client = new Redis(
    process.env["QODER_SAMPLE_REDIS_URL"] ?? "redis://127.0.0.1:6379",
  );
  const store = new RedisSessionStore(client);
  const marker = `session-storage-${randomUUID()}`;
  let sessionId: string | undefined;

  try {
    console.log("[host-a] Starting a session with Redis storage.");
    const first = await runQuery({
      workspace,
      store,
      prompt: `Remember this exact deployment marker: ${marker}. Reply only that it is stored.`,
    });
    sessionId = first.session_id;
    await deleteSession(sessionId, { dir: workspace });
    console.log(
      `[host-a] Stored session ${sessionId}; local transcript deleted.`,
    );

    console.log("[host-b] Starting without host A's local transcript.");
    const resumed = await runQuery({
      workspace,
      store,
      resume: sessionId,
      prompt:
        "What exact deployment marker did I ask you to remember? Reply only with the marker.",
    });
    console.log(`[host-b] Resumed session ${resumed.session_id}.`);
    console.log(`[host-b] Agent response: ${resumed.result}`);

    if (!resumed.result.includes(marker)) {
      throw new Error("The resumed response did not contain the stored marker.");
    }
    console.log("[app] External session handoff verified.");
  } finally {
    try {
      if (sessionId) {
        const localSession = await getSessionInfo(sessionId, {
          dir: workspace,
        });
        if (localSession) {
          await deleteSession(sessionId, { dir: workspace });
        }
        await deleteSession(sessionId, {
          dir: workspace,
          sessionStore: store,
        });
        console.log("[app] Deleted sample transcript.");
      }
    } finally {
      await client.quit();
    }
  }
}

async function main(): Promise<void> {
  await run(resolve(process.argv[2] ?? process.cwd()));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
