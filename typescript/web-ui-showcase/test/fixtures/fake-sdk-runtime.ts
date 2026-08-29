import { randomUUID } from "node:crypto";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";
import type {
  HistoricalMessage,
  SessionCatalog,
  SessionRecord,
} from "../../src/server/services/session-catalog-port.js";

/** In-memory Workspace metadata used only by the deterministic browser server. */
export class FixtureWorkspaceRepository implements WorkspaceRepository {
  readonly #workspaces = new Map<string, StoredWorkspace>();

  async list(): Promise<StoredWorkspace[]> {
    return [...this.#workspaces.values()].map((workspace) => ({ ...workspace }));
  }

  async registerOrGetByPath(
    workspace: StoredWorkspace,
  ): Promise<StoredWorkspace> {
    const existing = [...this.#workspaces.values()].find(
      (candidate) => candidate.path === workspace.path,
    );
    if (existing !== undefined) return { ...existing };
    this.#workspaces.set(workspace.id, { ...workspace });
    return { ...workspace };
  }

  async upsert(workspace: StoredWorkspace): Promise<void> {
    this.#workspaces.set(workspace.id, { ...workspace });
  }

  async remove(workspaceId: string): Promise<void> {
    this.#workspaces.delete(workspaceId);
  }
}

/** Mutable SDK-session catalog shared by fixture Queries and the real services. */
export class FixtureSessionCatalog implements SessionCatalog {
  readonly #records = new Map<string, SessionRecord>();
  readonly #messages = new Map<string, HistoricalMessage[]>();
  readonly #elicitations = new Map<string, Record<string, unknown>>();
  readonly #subagents = new Map<string, Map<string, HistoricalMessage[]>>();

  ensureSession(cwd: string, sessionId: string): void {
    if (this.#records.has(sessionId)) return;
    const now = new Date().toISOString();
    this.#records.set(sessionId, {
      id: sessionId,
      cwd,
      title: "新建 Session",
      createdAt: now,
      updatedAt: now,
      gitBranch: "fixture/main",
    });
    this.#messages.set(sessionId, []);
  }

  recordTurn(input: {
    sessionId: string;
    messageId: string;
    text: string;
    assistantText: string;
  }): void {
    const messages = this.#messages.get(input.sessionId) ?? [];
    const timestamp = new Date().toISOString();
    messages.push(
      {
        type: "user",
        id: input.messageId,
        sessionId: input.sessionId,
        message: { role: "user", content: input.text },
        parentToolUseId: null,
        timestamp,
      },
      {
        type: "assistant",
        id: randomUUID(),
        sessionId: input.sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: input.assistantText }],
        },
        parentToolUseId: null,
        timestamp,
      },
    );
    this.#messages.set(input.sessionId, messages);
  }

  rewindConversation(sessionId: string, userMessageId: string): void {
    const messages = this.#messages.get(sessionId) ?? [];
    const target = messages.findIndex(
      (message) => message.type === "user" && message.id === userMessageId,
    );
    if (target === -1) {
      throw new Error("Fixture rewind target does not exist");
    }
    this.#messages.set(
      sessionId,
      messages.slice(0, target + 1).map((message) => ({ ...message })),
    );
  }

  recordElicitation(
    sessionId: string,
    content: Record<string, unknown>,
  ): void {
    this.#elicitations.set(sessionId, structuredClone(content));
  }

  recordSubagent(
    sessionId: string,
    agentId: string,
    messages: HistoricalMessage[],
  ): void {
    const agents = this.#subagents.get(sessionId) ?? new Map();
    agents.set(agentId, messages.map((message) => ({ ...message })));
    this.#subagents.set(sessionId, agents);
  }

  elicitation(sessionId: string): Record<string, unknown> | undefined {
    const content = this.#elicitations.get(sessionId);
    return content === undefined ? undefined : structuredClone(content);
  }

  async listForWorkspace(cwd: string): Promise<SessionRecord[]> {
    return [...this.#records.values()]
      .filter((record) => record.cwd === cwd)
      .map((record) => ({ ...record }));
  }

  async get(cwd: string, sessionId: string): Promise<SessionRecord | undefined> {
    const record = this.#records.get(sessionId);
    return record?.cwd === cwd ? { ...record } : undefined;
  }

  async messages(cwd: string, sessionId: string): Promise<HistoricalMessage[]> {
    const record = this.#records.get(sessionId);
    return record?.cwd === cwd
      ? (this.#messages.get(sessionId) ?? []).map((message) => ({ ...message }))
      : [];
  }

  async rename(cwd: string, sessionId: string, title: string): Promise<void> {
    this.#update(cwd, sessionId, { title });
  }

  async tag(cwd: string, sessionId: string, tag: string): Promise<void> {
    this.#update(cwd, sessionId, { tag });
  }

  async fork(
    cwd: string,
    sessionId: string,
    input: { upToMessageId?: string; title?: string },
  ): Promise<{ sessionId: string }> {
    const source = this.#records.get(sessionId);
    if (source === undefined || source.cwd !== cwd) {
      throw new Error("Fixture Session does not exist");
    }
    const forkId = randomUUID();
    this.#records.set(forkId, {
      ...source,
      id: forkId,
      title: input.title ?? `${source.title} (fork)`,
      updatedAt: new Date().toISOString(),
    });
    const history = this.#messages.get(sessionId) ?? [];
    const limit =
      input.upToMessageId === undefined
        ? history.length
        : Math.max(
            0,
            history.findIndex((message) => message.id === input.upToMessageId) + 1,
          );
    this.#messages.set(forkId, history.slice(0, limit).map((message) => ({ ...message, sessionId: forkId })));
    return { sessionId: forkId };
  }

  async delete(cwd: string, sessionId: string): Promise<void> {
    const record = this.#records.get(sessionId);
    if (record?.cwd === cwd) {
      this.#records.delete(sessionId);
      this.#messages.delete(sessionId);
      this.#elicitations.delete(sessionId);
      this.#subagents.delete(sessionId);
    }
  }

  async listSubagents(
    _cwd: string,
    sessionId: string,
  ): Promise<string[]> {
    return [...(this.#subagents.get(sessionId)?.keys() ?? [])];
  }

  async subagentMessages(
    _cwd: string,
    sessionId: string,
    agentId: string,
  ): Promise<HistoricalMessage[]> {
    return (this.#subagents.get(sessionId)?.get(agentId) ?? [])
      .map((message) => ({ ...message }));
  }

  #update(
    cwd: string,
    sessionId: string,
    patch: Pick<SessionRecord, "title"> | Pick<SessionRecord, "tag">,
  ): void {
    const record = this.#records.get(sessionId);
    if (record === undefined || record.cwd !== cwd) {
      throw new Error("Fixture Session does not exist");
    }
    this.#records.set(sessionId, {
      ...record,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}
