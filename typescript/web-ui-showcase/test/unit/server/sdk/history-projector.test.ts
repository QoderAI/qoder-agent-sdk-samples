import { describe, expect, it } from "vitest";
import { projectHistory } from "../../../../src/server/sdk/history-projector.js";
import type { HistoricalMessage } from "../../../../src/server/services/session-catalog-port.js";

const sessionId = "00000000-0000-4000-8000-000000000411";

describe("Session history projection", () => {
  it("keeps child-agent records out of main history but can project a Subagent transcript", () => {
    const messages: HistoricalMessage[] = [
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000490",
        sessionId,
        message: { role: "user", content: "Child instruction" },
        parentToolUseId: "agent-tool-1",
        timestamp: "2026-08-14T07:00:00.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000491",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Child answer" }],
        },
        parentToolUseId: "agent-tool-1",
        timestamp: "2026-08-14T07:00:01.000Z",
      },
    ];

    expect(projectHistory(messages)).toEqual([]);
    expect(projectHistory(messages, { includeChildMessages: true })).toEqual([
      expect.objectContaining({ kind: "user", text: "Child instruction" }),
      expect.objectContaining({ kind: "assistant", text: "Child answer" }),
    ]);
  });

  it("retains transcript identifiers and timestamps", () => {
    const messages: HistoricalMessage[] = [
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000412",
        sessionId,
        message: { role: "user", content: "Inspect the project" },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:00.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000413",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I found the entry point." }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:01.000Z",
      },
    ];

    expect(projectHistory(messages)).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000412",
        sessionId,
        kind: "user",
        text: "Inspect the project",
        createdAt: "2026-08-14T07:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000413",
        sessionId,
        kind: "assistant",
        text: "I found the entry point.",
        status: "complete",
        createdAt: "2026-08-14T07:00:01.000Z",
      },
    ]);
  });

  it("keeps diagnostic system history out of the product conversation", () => {
    const messages: HistoricalMessage[] = [
      {
        type: "system",
        id: "00000000-0000-4000-8000-000000000414",
        sessionId,
        message: {},
        parentToolUseId: null,
        subtype: "compact_boundary",
        compactMetadata: {
          trigger: "auto",
          pre_tokens: 12_000,
          post_tokens: 3_000,
        },
      },
      {
        type: "system",
        id: "00000000-0000-4000-8000-000000000415",
        sessionId,
        message: { access_token: "secret" },
        parentToolUseId: null,
      },
    ];

    expect(projectHistory(messages)).toEqual([]);
  });

  it("filters SDK control receipts from restored history without hiding user prose", () => {
    const texts = [
      "[Request interrupted by user]",
      'Goal still active - model has not called update_goal(status="complete")',
      "<command-message>plan</command-message>\n<command-name>/plan</command-name>",
      "<local-command-stdout>Compacted </local-command-stdout>",
      "<task-notification>\n<task-id>task-1</task-id>\n<tool-use-id>tool-1</tool-use-id>\n<output-file>/tmp/task-1.output</output-file>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>",
      "用户写了 [Request interrupted by user] 作为示例",
      "请解释 <local-command-stdout> 标签",
    ];
    const messages: HistoricalMessage[] = texts.map((text, index) => ({
      type: "user",
      id: `00000000-0000-4000-8000-00000000042${index}`,
      sessionId,
      message: { role: "user", content: text },
      parentToolUseId: null,
      timestamp: `2026-08-14T07:00:0${index}.000Z`,
    }));

    expect(projectHistory(messages)).toEqual([
      expect.objectContaining({
        kind: "user",
        text: "用户写了 [Request interrupted by user] 作为示例",
      }),
      expect.objectContaining({
        kind: "user",
        text: "请解释 <local-command-stdout> 标签",
      }),
    ]);
  });

  it("hides a generated compact summary without hiding the next real user message", () => {
    const compactedAt = "2026-08-14T07:10:00.000Z";
    const messages: HistoricalMessage[] = [
      {
        type: "system",
        id: "00000000-0000-4000-8000-000000000430",
        sessionId,
        message: {},
        parentToolUseId: null,
        subtype: "compact_boundary",
        compactMetadata: { trigger: "manual", pre_tokens: 24_784 },
        timestamp: compactedAt,
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000431",
        sessionId,
        message: {
          role: "user",
          content: [{
            type: "text",
            text: "This session is being continued from a previous conversation. Internal summary.",
          }],
        },
        parentToolUseId: null,
        timestamp: compactedAt,
      },
      {
        type: "system",
        id: "00000000-0000-4000-8000-000000000432",
        sessionId,
        message: {},
        parentToolUseId: null,
        subtype: "compact_boundary",
        compactMetadata: { trigger: "auto", pre_tokens: 18_000 },
        timestamp: "2026-08-14T07:20:00.000Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000433",
        sessionId,
        message: { role: "user", content: "压缩完成后继续检查项目" },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:20:01.000Z",
      },
    ];

    expect(projectHistory(messages)).toEqual([
      {
        id: "00000000-0000-4000-8000-000000000433",
        sessionId,
        kind: "user",
        text: "压缩完成后继续检查项目",
        createdAt: "2026-08-14T07:20:01.000Z",
      },
    ]);
  });

  it("rebuilds completed and failed Tool rows without duplicating or exposing credentials", () => {
    const messages: HistoricalMessage[] = [
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000416",
        sessionId,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "先读取配置。" },
            {
              type: "tool_use",
              id: "tool-read",
              name: "Read",
              input: { file_path: "config.json", apiKey: "input-secret" },
            },
          ],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:02.000Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000417",
        sessionId,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool-read",
            content: { text: "读取完成", accessToken: "result-secret" },
          }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:02.250Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000420",
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
        id: "00000000-0000-4000-8000-000000000418",
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
        id: "00000000-0000-4000-8000-000000000419",
        sessionId,
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: "tool-write",
            is_error: true,
            content: { message: "写入失败", password: "failure-secret" },
          }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:03.500Z",
      },
      {
        type: "user",
        id: "00000000-0000-4000-8000-000000000421",
        sessionId,
        message: { role: "user", content: "下一轮" },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:04.000Z",
      },
      {
        type: "assistant",
        id: "00000000-0000-4000-8000-000000000422",
        sessionId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "新的回复。" }],
        },
        parentToolUseId: null,
        timestamp: "2026-08-14T07:00:04.500Z",
      },
    ];

    const first = projectHistory(messages);
    const second = projectHistory(messages);
    const tools = first.filter((item) => item.kind === "tool");

    expect(first.map((item) => item.kind)).toEqual([
      "assistant",
      "tool",
      "assistant",
      "tool",
      "user",
      "assistant",
    ]);
    expect(first.filter((item) => item.kind === "assistant")).toMatchObject([
      { text: "先读取配置。" },
      { text: "读取完成后继续。" },
      { text: "新的回复。" },
    ]);
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      toolUseId: "tool-read",
      name: "Read",
      lifecycle: "completed",
      input: { file_path: "config.json", apiKey: "[REDACTED]" },
      result: { text: "读取完成", accessToken: "[REDACTED]" },
      startedAt: "2026-08-14T07:00:02.000Z",
      completedAt: "2026-08-14T07:00:02.250Z",
      durationMs: 250,
    });
    expect(tools[1]).toMatchObject({
      toolUseId: "tool-write",
      lifecycle: "failed",
      result: { message: "写入失败", password: "[REDACTED]" },
      durationMs: 500,
    });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("input-secret");
    expect(JSON.stringify(first)).not.toContain("result-secret");
    expect(JSON.stringify(first)).not.toContain("failure-secret");
  });
});
