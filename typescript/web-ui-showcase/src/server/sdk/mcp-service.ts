import type { McpServerStatus } from "@qoder-ai/qoder-agent-sdk";
import type { McpServerView } from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import type { QueryPort } from "./query-port.js";
import { boundedErrorText } from "./error-text-redact.js";
import {
  redactForBrowser,
  safeDiagnosticRecord,
} from "./redact.js";
import type { SessionRegistry } from "./session-registry.js";

const MCP_TOOL_LIMIT = 100;
const MCP_TOOL_NAME_LIMIT = 256;
const MCP_TOOL_DESCRIPTION_LIMIT = 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadataRecord(value: unknown): Record<string, unknown> {
  const projected = redactForBrowser(value);
  return isRecord(projected)
    ? safeDiagnosticRecord(projected)
    : safeDiagnosticRecord({
        unavailable: true,
        projected,
      });
}

function toolRecord(
  value: unknown,
  index: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    return { name: `MCP tool ${index + 1}`, metadataUnavailable: true };
  }
  const projected = safeDiagnosticRecord(value);
  const name = typeof projected.name === "string"
    ? boundedErrorText(projected.name, MCP_TOOL_NAME_LIMIT).trim()
    : "";
  const description = typeof projected.description === "string"
    ? boundedErrorText(projected.description, MCP_TOOL_DESCRIPTION_LIMIT).trim()
    : undefined;
  return {
    ...projected,
    name: name || `MCP tool ${index + 1}`,
    ...(description === undefined ? {} : { description }),
  };
}

function toolRecords(value: unknown): Array<Record<string, unknown>> {
  const projected = redactForBrowser(value);
  if (!Array.isArray(projected)) {
    return [{
      name: "MCP tool metadata unavailable",
      metadata: metadataRecord(projected),
    }];
  }
  if (projected.length <= MCP_TOOL_LIMIT) {
    return projected.map(toolRecord);
  }
  const visible = projected
    .slice(0, MCP_TOOL_LIMIT - 1)
    .map(toolRecord);
  visible.push({
    name: "Additional MCP tools omitted",
    omittedTools: projected.length - visible.length,
  });
  return visible;
}

function statusView(
  sessionId: string,
  status: McpServerStatus,
): McpServerView {
  const normalized =
    status.status === "pending"
      ? "connecting"
      : status.status === "disabled"
        ? "disconnected"
        : status.status;
  return {
    sessionId,
    name: status.name,
    status: normalized,
    ...(status.serverInfo === undefined
      ? {}
      : { serverInfo: metadataRecord(status.serverInfo) }),
    ...(status.tools === undefined
      ? {}
      : { tools: toolRecords(status.tools) }),
    ...(status.status !== "failed"
      ? {}
      : {
          error: {
            code: "MCP_SERVER_FAILED",
            message: "The MCP server reported a connection failure.",
            retryable: true,
          },
        }),
  };
}

/** Drives public MCP status and OAuth controls for live SDK Queries. */
export class McpService {
  readonly #journal: EventJournal;
  readonly #registry: SessionRegistry;
  readonly #restartSession: (sessionId: string) => Promise<void>;
  readonly #servers = new Map<string, McpServerView>();

  constructor(options: {
    journal: EventJournal;
    registry: SessionRegistry;
    restartSession: (sessionId: string) => Promise<void>;
  }) {
    this.#journal = options.journal;
    this.#registry = options.registry;
    this.#restartSession = options.restartSession;
  }

  async preflight(
    sessionId: string,
    query: QueryPort,
    options?: { shouldCommit(): boolean },
  ): Promise<McpServerView[]> {
    const statuses = await query.mcpServerStatus();
    const views = statuses.map((status) => statusView(sessionId, status));
    if (options?.shouldCommit() === false) return views;
    for (const view of views) this.#publish(view);
    return views;
  }

  requireReady(sessionId: string): void {
    const blocked = this.snapshot().find(
      (server) =>
        server.sessionId === sessionId && server.status === "needs-auth",
    );
    if (blocked !== undefined) {
      throw new AppError({
        code: "MCP_AUTH_REQUIRED",
        message: `Authenticate the ${blocked.name} MCP server before sending a message.`,
        status: 409,
        retryable: true,
        details: { serverName: blocked.name },
      });
    }
  }

  requireServer(sessionId: string, serverName: string): McpServerView {
    const server = this.#servers.get(this.#key(sessionId, serverName));
    if (server === undefined) {
      throw new AppError({
        code: "MCP_SERVER_NOT_FOUND",
        message: "The selected MCP server is not part of this Session.",
        status: 404,
        retryable: false,
      });
    }
    return server;
  }

  async authenticate(sessionId: string, serverName: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      await this.#authenticateUnlocked(sessionId, serverName);
    });
  }

  async #authenticateUnlocked(
    sessionId: string,
    serverName: string,
  ): Promise<void> {
    const current = this.requireServer(sessionId, serverName);
    const query = this.#query(sessionId);
    this.#publish({
      sessionId,
      name: serverName,
      status: "connecting",
      ...(current.serverInfo === undefined
        ? {}
        : { serverInfo: current.serverInfo }),
      ...(current.tools === undefined ? {} : { tools: current.tools }),
    });
    try {
      const result = await query.mcpAuthenticate(serverName);
      if (!result.requiresUserAction) {
        this.#publish({
          sessionId,
          name: serverName,
          status: "connected",
        });
        return;
      }
      const authUrl = this.#safeAuthUrl(result.authUrl);
      this.#publish({
        sessionId,
        name: serverName,
        status: "needs-auth",
        authUrl,
      });
    } catch (error) {
      this.#publishFailure(sessionId, serverName);
      throw error;
    }
  }

  async submitCallback(
    sessionId: string,
    serverName: string,
    callbackUrl: string,
  ): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      await this.#submitCallbackUnlocked(sessionId, serverName, callbackUrl);
    });
  }

  async #submitCallbackUnlocked(
    sessionId: string,
    serverName: string,
    callbackUrl: string,
  ): Promise<void> {
    this.requireServer(sessionId, serverName);
    const query = this.#query(sessionId);
    this.#publish({
      sessionId,
      name: serverName,
      status: "connecting",
    });
    try {
      await query.mcpSubmitOAuthCallbackUrl(serverName, callbackUrl);
      await this.preflight(sessionId, query);
    } catch (error) {
      this.#publishFailure(sessionId, serverName);
      throw error;
    }
  }

  async reconnect(sessionId: string, serverName: string): Promise<void> {
    this.requireServer(sessionId, serverName);
    await this.#restartSession(sessionId);
  }

  snapshot(): McpServerView[] {
    return [...this.#servers.values()];
  }

  clearSession(sessionId: string): void {
    for (const [key, server] of this.#servers) {
      if (server.sessionId === sessionId) this.#servers.delete(key);
    }
  }

  #query(sessionId: string): QueryPort {
    const controller = this.#registry.get(sessionId);
    if (controller === undefined) {
      throw new AppError({
        code: "SESSION_NOT_LIVE",
        message: "此 Session 当前不可用。请重新选择该 Session 后重试 MCP control。",
        status: 409,
        retryable: true,
      });
    }
    return controller.query();
  }

  #publish(view: McpServerView): void {
    this.#servers.set(this.#key(view.sessionId, view.name), view);
    this.#journal.publish(
      { type: "mcp.status", payload: view },
      { sessionId: view.sessionId },
    );
  }

  #publishFailure(sessionId: string, serverName: string): void {
    this.#publish({
      sessionId,
      name: serverName,
      status: "failed",
      error: {
        code: "MCP_CONTROL_FAILED",
        message: "The MCP server control request failed.",
        retryable: true,
      },
    });
  }

  #safeAuthUrl(value: string | undefined): string {
    if (value !== undefined) {
      try {
        const url = new URL(value);
        if (url.protocol === "http:" || url.protocol === "https:") {
          return url.toString();
        }
      } catch {
        // The SDK result is an external wire value and may contain an invalid URL.
      }
    }
    throw new AppError({
      code: "MCP_AUTH_URL_INVALID",
      message: "The MCP server returned an invalid authentication URL.",
      status: 502,
      retryable: false,
    });
  }

  #key(sessionId: string, serverName: string): string {
    return `${sessionId}:${serverName}`;
  }
}
