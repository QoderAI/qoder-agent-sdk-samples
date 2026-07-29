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
import pg, { type Pool } from "pg";

const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * PostgreSQL reference adapter with one row per transcript entry.
 *
 * The increasing seq column preserves the order returned by load().
 */
export class PostgresSessionStore implements SessionStore {
  constructor(
    private readonly pool: Pool,
    private readonly tableName = "qoder_session_entries",
  ) {
    if (!SQL_IDENTIFIER.test(tableName)) {
      throw new Error(
        `Invalid table name ${JSON.stringify(tableName)}. Use letters, digits, and underscores.`,
      );
    }
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        seq BIGSERIAL PRIMARY KEY,
        project_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        subpath TEXT NOT NULL DEFAULT '',
        entry JSONB NOT NULL,
        modified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_lookup_idx
      ON ${this.tableName} (project_key, session_id, subpath, seq)
    `);
  }

  async append(
    key: SessionKey,
    entries: SessionStoreEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const values: unknown[] = [
      key.projectKey,
      key.sessionId,
      key.subpath ?? "",
    ];
    const rows = entries.map((entry, index) => {
      values.push(JSON.stringify(entry));
      return `($1, $2, $3, $${index + 4}::jsonb)`;
    });
    await this.pool.query(
      `
        INSERT INTO ${this.tableName}
          (project_key, session_id, subpath, entry)
        VALUES ${rows.join(", ")}
      `,
      values,
    );
  }

  async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
    const result = await this.pool.query<{ entry: SessionStoreEntry }>(
      `
        SELECT entry
        FROM ${this.tableName}
        WHERE project_key = $1
          AND session_id = $2
          AND subpath = $3
        ORDER BY seq
      `,
      [key.projectKey, key.sessionId, key.subpath ?? ""],
    );
    return result.rows.length === 0
      ? null
      : result.rows.map(({ entry }) => entry);
  }

  async listSessions(
    projectKey: string,
  ): Promise<Array<{ sessionId: string; mtime: number }>> {
    const result = await this.pool.query<{
      session_id: string;
      modified_at: Date;
    }>(
      `
        SELECT session_id, MAX(modified_at) AS modified_at
        FROM ${this.tableName}
        WHERE project_key = $1 AND subpath = ''
        GROUP BY session_id
        ORDER BY modified_at DESC
      `,
      [projectKey],
    );
    return result.rows.map(({ session_id, modified_at }) => ({
      sessionId: session_id,
      mtime: modified_at.getTime(),
    }));
  }

  async listSubkeys(
    key: Omit<SessionKey, "subpath">,
  ): Promise<string[]> {
    const result = await this.pool.query<{ subpath: string }>(
      `
        SELECT DISTINCT subpath
        FROM ${this.tableName}
        WHERE project_key = $1
          AND session_id = $2
          AND subpath <> ''
        ORDER BY subpath
      `,
      [key.projectKey, key.sessionId],
    );
    return result.rows.map(({ subpath }) => subpath);
  }

  async delete(key: SessionKey): Promise<void> {
    if (key.subpath === undefined) {
      await this.pool.query(
        `
          DELETE FROM ${this.tableName}
          WHERE project_key = $1 AND session_id = $2
        `,
        [key.projectKey, key.sessionId],
      );
      return;
    }
    await this.pool.query(
      `
        DELETE FROM ${this.tableName}
        WHERE project_key = $1
          AND session_id = $2
          AND subpath = $3
      `,
      [key.projectKey, key.sessionId, key.subpath],
    );
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
  const pool = new pg.Pool({
    connectionString:
      process.env["QODER_SAMPLE_POSTGRES_URL"] ??
      "postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store",
  });
  const store = new PostgresSessionStore(pool);
  const marker = `session-storage-${randomUUID()}`;
  let sessionId: string | undefined;

  try {
    await store.ensureSchema();
    console.log("[host-a] Starting a session with PostgreSQL storage.");
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
      await pool.end();
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
