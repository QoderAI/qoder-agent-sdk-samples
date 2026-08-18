import {
  commandAcceptedSchema,
  type InteractionResponse,
  type SelectablePermissionMode,
  type SendMessageInput,
  sessionStartedSchema,
  type SessionStarted,
  type StartSessionCommand,
} from "../../shared/commands.js";
import { wireErrorSchema, type WireError } from "../../shared/errors.js";
import { subagentTranscriptResponseSchema } from "../../shared/subagents.js";
import {
  workspaceFileSearchResultSchema,
  type WorkspaceFileSearchResult,
} from "../../shared/workspace-files.js";
import { z } from "zod";

export class ApiError extends Error implements WireError {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(error: WireError) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.details !== undefined) this.details = error.details;
  }
}

type Accepted = { commandId: string };
type JsonObject = object;

/** Typed browser client for accepted REST commands; WebSocket stays read-only. */
export class ApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  registerWorkspace(input: { path: string }): Promise<Accepted> {
    return this.#accepted("/api/workspaces", "POST", input);
  }
  pickWorkspace(): Promise<Accepted> {
    return this.#accepted("/api/workspaces/pick", "POST", {});
  }
  searchWorkspaceFiles(
    sessionId: string,
    query: string,
  ): Promise<WorkspaceFileSearchResult> {
    const params = new URLSearchParams({ q: query });
    return this.#read(
      `/api/sessions/${sessionId}/files?${params.toString()}`,
      workspaceFileSearchResultSchema,
    );
  }
  startSession(input: StartSessionCommand): Promise<SessionStarted> {
    return this.#synchronous(
      "/api/sessions/start",
      "POST",
      input,
      sessionStartedSchema,
    );
  }
  ensureSession(sessionId: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/ensure`, "POST", {});
  }
  sendMessage(
    sessionId: string,
    input: SendMessageInput,
  ): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/messages`, "POST", input);
  }
  cancelMessage(sessionId: string, messageUuid: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/messages/${messageUuid}`,
      "DELETE",
    );
  }
  stopTask(sessionId: string, taskId: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/tasks/${encodeURIComponent(taskId)}/stop`,
      "POST",
      {},
    );
  }
  interruptSession(sessionId: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/interrupt`, "POST", {});
  }
  renameSession(sessionId: string, title: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/title`, "PATCH", {
      title,
    });
  }
  tagSession(sessionId: string, tag: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/tag`, "PATCH", { tag });
  }
  forkSession(sessionId: string, input: JsonObject = {}): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/fork`, "POST", input);
  }
  deleteSession(sessionId: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}`, "DELETE");
  }
  respondToInteraction(
    interactionId: string,
    response: InteractionResponse,
  ): Promise<Accepted> {
    return this.#accepted(
      `/api/interactions/${interactionId}/respond`,
      "POST",
      response,
    );
  }
  authenticateMcp(sessionId: string, serverName: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/mcp/${encodeURIComponent(serverName)}/authenticate`,
      "POST",
      {},
    );
  }
  submitMcpCallback(
    sessionId: string,
    serverName: string,
    callbackUrl: string,
  ): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/mcp/${encodeURIComponent(serverName)}/oauth-callback`,
      "POST",
      { callbackUrl },
    );
  }
  reconnectMcp(sessionId: string, serverName: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/mcp/${encodeURIComponent(serverName)}/reconnect`,
      "POST",
      {},
    );
  }
  setModel(sessionId: string, model?: string): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/model`, "PATCH", {
      ...(model === undefined ? {} : { model }),
    });
  }
  setPermissionMode(
    sessionId: string,
    permissionMode: SelectablePermissionMode,
  ): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/permission-mode`,
      "PATCH",
      { permissionMode },
    );
  }
  addDirectories(sessionId: string, directories: string[]): Promise<Accepted> {
    return this.#accepted(`/api/sessions/${sessionId}/directories`, "POST", {
      directories,
    });
  }
  backgroundTasks(sessionId: string, toolUseId?: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/tasks/background`,
      "POST",
      toolUseId === undefined ? {} : { toolUseId },
    );
  }
  refreshRuntime(sessionId: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/runtime/refresh`,
      "POST",
      {},
    );
  }
  refreshContext(sessionId: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/context/refresh`,
      "POST",
      {},
    );
  }
  reloadPlugins(sessionId: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/plugins/reload`,
      "POST",
      {},
    );
  }
  generateTitle(sessionId: string, description: string): Promise<Accepted> {
    return this.#accepted(
      `/api/sessions/${sessionId}/title/generate`,
      "POST",
      { description },
    );
  }

  async getSubagentTranscript(
    sessionId: string,
    toolUseId: string,
    signal?: AbortSignal,
  ) {
    return this.#read(
      `/api/sessions/${sessionId}/subagents/by-tool/${encodeURIComponent(toolUseId)}`,
      subagentTranscriptResponseSchema,
      signal === undefined ? undefined : { signal },
    );
  }

  async #read<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    if (response.ok) return schema.parse(await response.json());
    throw await this.#responseError(response);
  }

  async #accepted(
    path: string,
    method: string,
    body?: JsonObject,
  ): Promise<Accepted> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (response.ok) {
      return commandAcceptedSchema.parse(await response.json());
    }
    throw await this.#responseError(response);
  }

  async #synchronous<T>(
    path: string,
    method: string,
    body: JsonObject,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return schema.parse(await response.json());
    throw await this.#responseError(response);
  }

  async #responseError(response: Response): Promise<ApiError> {
    let parsed: WireError | undefined;
    try {
      parsed = wireErrorSchema.parse(await response.json());
    } catch {
      parsed = undefined;
    }
    return new ApiError(
      parsed ?? {
        code: "PROTOCOL_ERROR",
        message: "The local server returned an invalid error response.",
        retryable: false,
      },
    );
  }
}
