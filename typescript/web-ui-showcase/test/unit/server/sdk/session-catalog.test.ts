import { describe, expect, it, vi } from "vitest";
import {
  createSessionCatalog,
  type SdkSessionFunctions,
} from "../../../../src/server/sdk/session-catalog.js";

const sessionId = "00000000-0000-4000-8000-000000000101";

function createFunctions(): SdkSessionFunctions {
  return {
    listSessions: vi.fn(async () => [
      {
        sessionId,
        summary: "Inspect the repository",
        lastModified: 1_720_000_000_000,
        cwd: "/repo",
        tag: "review",
      },
    ]),
    getSessionInfo: vi.fn(async () => undefined),
    getSessionMessages: vi.fn(async () => [
      {
        type: "user" as const,
        uuid: "00000000-0000-4000-8000-000000000102",
        session_id: sessionId,
        message: { role: "user", content: "Inspect" },
        parent_tool_use_id: null,
        parent_agent_id: null,
        timestamp: "2026-08-14T08:00:00.000Z",
      },
    ]),
    renameSession: vi.fn(async () => undefined),
    tagSession: vi.fn(async () => undefined),
    forkSession: vi.fn(async () => ({
      sessionId: "00000000-0000-4000-8000-000000000103",
    })),
    deleteSession: vi.fn(async () => undefined),
    listSubagents: vi.fn(async () => ["agent-a"]),
    getSubagentMessages: vi.fn(async () => []),
  };
}

describe("SDK Session catalog adapter", () => {
  it("maps Session metadata and preserves the Workspace directory", async () => {
    const functions = createFunctions();
    const catalog = createSessionCatalog(functions);

    expect(await catalog.listForWorkspace("/repo")).toEqual([
      {
        id: sessionId,
        cwd: "/repo",
        title: "Inspect the repository",
        updatedAt: "2024-07-03T09:46:40.000Z",
        tag: "review",
      },
    ]);
    expect(functions.listSessions).toHaveBeenCalledWith({ dir: "/repo" });
  });

  it("requests system history and maps durable transcript fields", async () => {
    const functions = createFunctions();
    const catalog = createSessionCatalog(functions);

    expect(await catalog.messages("/repo", sessionId)).toEqual([
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000102",
        sessionId,
        message: { role: "user", content: "Inspect" },
        parentToolUseId: null,
        timestamp: "2026-08-14T08:00:00.000Z",
      },
    ]);
    expect(functions.getSessionMessages).toHaveBeenCalledWith(sessionId, {
      dir: "/repo",
      includeSystemMessages: true,
    });
  });

  it("scopes every metadata, fork, delete, and subagent call by directory", async () => {
    const functions = createFunctions();
    const catalog = createSessionCatalog(functions);

    await catalog.rename("/repo", sessionId, "New title");
    await catalog.tag("/repo", sessionId, "review");
    await catalog.fork("/repo", sessionId, {
      upToMessageId: "00000000-0000-4000-8000-000000000104",
      title: "Fork",
    });
    await catalog.listSubagents("/repo", sessionId);
    await catalog.subagentMessages("/repo", sessionId, "agent-a");
    await catalog.delete("/repo", sessionId);

    expect(functions.renameSession).toHaveBeenCalledWith(
      sessionId,
      "New title",
      { dir: "/repo" },
    );
    expect(functions.tagSession).toHaveBeenCalledWith(sessionId, "review", {
      dir: "/repo",
    });
    expect(functions.forkSession).toHaveBeenCalledWith(sessionId, {
      dir: "/repo",
      upToMessageId: "00000000-0000-4000-8000-000000000104",
      title: "Fork",
    });
    expect(functions.listSubagents).toHaveBeenCalledWith(sessionId, {
      dir: "/repo",
    });
    expect(functions.getSubagentMessages).toHaveBeenCalledWith(
      sessionId,
      "agent-a",
      { dir: "/repo" },
    );
    expect(functions.deleteSession).toHaveBeenCalledWith(sessionId, {
      dir: "/repo",
    });
  });
});
