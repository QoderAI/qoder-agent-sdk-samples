import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/server/app.js";
import type {
  HistoricalMessage,
  SessionCatalog,
  SessionRecord,
} from "../../src/server/services/session-catalog-port.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../../src/server/persistence/workspace-repository.js";
import type { QueryFactory } from "../../src/server/sdk/query-factory.js";

const workspaceId = "00000000-0000-4000-8000-000000000711";
const sessionId = "00000000-0000-4000-8000-000000000712";
const apps: FastifyInstance[] = [];
let directory: string | undefined;

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("restart hydration", () => {
  it("rebuilds Restorable Sessions and history without creating a Query", async () => {
    directory = await realpath(
      await mkdtemp(join(tmpdir(), "qoder-restart-")),
    );
    const workspace: StoredWorkspace = {
      id: workspaceId,
      displayName: basename(directory),
      path: directory,
      createdAt: "2026-08-14T06:00:00.000Z",
      updatedAt: "2026-08-14T06:00:00.000Z",
    };
    const repository: WorkspaceRepository = {
      list: async () => [workspace],
      upsert: async () => undefined,
      remove: async () => undefined,
    };
    const record: SessionRecord = {
      id: sessionId,
      cwd: directory,
      title: "Persisted Session",
      updatedAt: "2026-08-14T07:00:00.000Z",
    };
    const messages: HistoricalMessage[] = [
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000713",
        sessionId,
        message: { role: "user", content: "Original prompt" },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:01.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000714",
        sessionId,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "先读取配置。" },
            {
              type: "tool_use",
              id: "tool-read",
              name: "Read",
              input: { file_path: "config.json", apiKey: "history-secret" },
            },
          ],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:02.000Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000715",
        sessionId,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool-read",
            content: { text: "读取完成", token: "result-secret" },
          }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:02.250Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000718",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "读取完成后继续。" }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:02.500Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000716",
        sessionId,
        message: {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: "tool-write",
            name: "Write",
            input: { file_path: "config.json" },
          }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:03.000Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000717",
        sessionId,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool-write",
            is_error: true,
            content: { message: "写入失败" },
          }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:03.500Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000719",
        sessionId,
        message: { role: "user", content: "下一轮" },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:04.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000720",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "新的回复。" }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:04.500Z",
      },
    ];
    const catalog = {
      listForWorkspace: async () => [record],
      get: async () => record,
      messages: async () => messages,
      rename: async () => undefined,
      tag: async () => undefined,
      fork: async () => ({ sessionId }),
      delete: async () => undefined,
      listSubagents: async () => [],
      subagentMessages: async () => [],
    } satisfies SessionCatalog;
    const create = vi.fn();
    const queryFactory = { create } as QueryFactory;

    const first = await createApp({
      assetRoot: null,
      workspaceRepository: repository,
      directoryPicker: { pick: async () => null },
      sessionCatalog: catalog,
      queryFactory,
    });
    apps.push(first);
    const firstSnapshot = await first.inject({
      method: "GET",
      url: `/api/snapshot?sessionId=${sessionId}`,
    });
    const second = await createApp({
      assetRoot: null,
      workspaceRepository: repository,
      directoryPicker: { pick: async () => null },
      sessionCatalog: catalog,
      queryFactory,
    });
    apps.push(second);
    const secondSnapshot = await second.inject({
      method: "GET",
      url: `/api/snapshot?sessionId=${sessionId}`,
    });

    const secondBody = secondSnapshot.json();
    expect(secondBody).toMatchObject({
      workspaces: [{ id: workspaceId }],
      sessions: [{ id: sessionId, phase: "restorable" }],
      messages: {
        [sessionId]: [
          {
            id: messages[0]?.id,
            kind: "user",
            createdAt: messages[0]?.timestamp,
          },
          {
            kind: "assistant",
            text: "先读取配置。",
          },
          {
            kind: "tool",
            toolUseId: "tool-read",
            lifecycle: "completed",
            input: { file_path: "config.json", apiKey: "[REDACTED]" },
            result: { text: "读取完成", token: "[REDACTED]" },
          },
          {
            kind: "assistant",
            text: "读取完成后继续。",
          },
          {
            kind: "tool",
            toolUseId: "tool-write",
            lifecycle: "failed",
          },
          { kind: "user", text: "下一轮" },
          { kind: "assistant", text: "新的回复。" },
        ],
      },
    });
    expect(secondBody.messages[sessionId].filter(
      (item: { kind: string }) => item.kind === "tool",
    )).toHaveLength(2);
    expect(secondBody.messages).toEqual(firstSnapshot.json().messages);
    expect(JSON.stringify(secondBody)).not.toContain("history-secret");
    expect(JSON.stringify(secondBody)).not.toContain("result-secret");
    expect(secondSnapshot.json().serverEpoch).not.toBe(
      firstSnapshot.json().serverEpoch,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
