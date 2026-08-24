import { describe, expect, it } from "vitest";
import type {
  SDKMessage,
  SDKResultError,
} from "@qoder-ai/qoder-agent-sdk";
import { projectSdkMessage } from "../../../../src/server/sdk/message-projector.js";

const sessionId = "00000000-0000-4000-8000-000000000401";
const itemId = "00000000-0000-4000-8000-000000000402";
const context = {
  sessionId,
  now: () => "2026-08-14T08:00:00.000Z",
  createId: () => itemId,
};
const usage: SDKResultError["usage"] = {
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: "",
  input_tokens: 0,
  iterations: [],
  output_tokens: 0,
  server_tool_use: {
    web_fetch_requests: 0,
    web_search_requests: 0,
  },
  service_tier: "",
  speed: "",
};

describe("SDK message projection", () => {
  it("keeps SDK control receipts out of the product transcript", () => {
    const hidden = [
      "[Request interrupted by user]",
      'Goal still active – model has not called update_goal(status="complete")',
      "<command-message>context</command-message>\n<command-name>/context</command-name>",
      "<local-command-stdout>Compacted </local-command-stdout>",
      [
        "<task-notification>",
        "<task-id>task-1</task-id>",
        "<tool-use-id>tool-1</tool-use-id>",
        "<output-file>/tmp/task-1.output</output-file>",
        "<status>completed</status>",
        "<summary>Background command completed</summary>",
        "</task-notification>",
      ].join("\n"),
    ];

    for (const text of hidden) {
      const message = {
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        uuid: itemId,
        session_id: sessionId,
        isSynthetic: false,
      } satisfies SDKMessage;
      expect(projectSdkMessage(message, {
        ...context,
        includeRawEvents: false,
      })).toEqual([]);
    }

    const ordinary = {
      type: "user",
      message: {
        role: "user",
        content: "请解释 <command-message>、<task-notification> 和 <local-command-stdout> 标签",
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
      isSynthetic: false,
    } satisfies SDKMessage;
    expect(projectSdkMessage(ordinary, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      expect.objectContaining({
        type: "conversation.add",
        item: expect.objectContaining({
          text: "请解释 <command-message>、<task-notification> 和 <local-command-stdout> 标签",
        }),
      }),
    ]);
  });

  it("keeps Assistant content blocks in their SDK order", () => {
    let nextId = 410;
    const message = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "先读取。" },
          {
            type: "tool_use",
            id: "tool-read",
            name: "Read",
            input: { file_path: "README.md" },
          },
          { type: "text", text: "读取完成。" },
        ],
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, {
      ...context,
      includeRawEvents: false,
      createId: () =>
        `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    })).toEqual([
      { type: "assistant.finalize", sourceId: `${itemId}:text:0`, text: "先读取。" },
      {
        type: "conversation.add",
        item: expect.objectContaining({
          kind: "tool",
          toolUseId: "tool-read",
          name: "Read",
        }),
      },
      { type: "assistant.finalize", sourceId: `${itemId}:text:2`, text: "读取完成。" },
    ]);
  });

  it("keeps adjacent Assistant text blocks as distinct semantic segments", () => {
    const message = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "第一段。" },
          { type: "text", text: "第二段。" },
        ],
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      {
        type: "assistant.finalize",
        sourceId: `${itemId}:text:0`,
        text: "第一段。",
      },
      {
        type: "assistant.finalize",
        sourceId: `${itemId}:text:1`,
        text: "第二段。",
      },
    ]);
  });

  it("suppresses Raw Events without suppressing semantic projection", () => {
    const assistant = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Visible answer" }],
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(assistant, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      {
        type: "assistant.finalize",
        sourceId: itemId,
        text: "Visible answer",
      },
    ]);
  });

  it("observes child-agent messages without adding them to the main transcript", () => {
    const childMessages = [
      {
        type: "user",
        message: { role: "user", content: "Instruction for the child agent" },
        parent_tool_use_id: "agent-tool-1",
        uuid: itemId,
        session_id: sessionId,
        isSynthetic: false,
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Child-agent answer" }],
        },
        parent_tool_use_id: "agent-tool-1",
        uuid: itemId,
        session_id: sessionId,
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Child delta" },
        },
        parent_tool_use_id: "agent-tool-1",
        uuid: itemId,
        session_id: sessionId,
      },
    ] satisfies SDKMessage[];

    for (const message of childMessages) {
      expect(projectSdkMessage(message, context)).toEqual([
        expect.objectContaining({
          type: "runtime.patch",
          patch: expect.objectContaining({ rawEvents: [expect.any(Object)] }),
        }),
      ]);
    }
  });

  it("projects assistant text and streaming deltas as one semantic segment", () => {
    const assistant = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;
    const stream = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(assistant, context)).toEqual([
      expect.objectContaining({ type: "runtime.patch" }),
      {
        type: "assistant.finalize",
        sourceId: itemId,
        text: "Hello",
      },
    ]);
    expect(projectSdkMessage(stream, context)).toEqual([
      expect.objectContaining({ type: "runtime.patch" }),
      {
        type: "assistant.delta",
        sourceId: itemId,
        text: " world",
      },
    ]);
  });

  it("projects tool requests with redacted input", () => {
    const message = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Read",
            input: { file_path: "/repo/README.md", access_token: "secret" },
          },
        ],
      },
      parent_tool_use_id: null,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, context)).toEqual([
      expect.objectContaining({ type: "runtime.patch" }),
      {
        type: "conversation.add",
        item: expect.objectContaining({
          id: itemId,
          kind: "tool",
          toolUseId: "tool-1",
          name: "Read",
          lifecycle: "requested",
          startedAt: "2026-08-14T08:00:00.000Z",
          input: {
            file_path: "/repo/README.md",
            access_token: "[REDACTED]",
          },
        }),
      },
    ]);
  });

  it("projects a matching SDK task start as Tool running", () => {
    const message = {
      type: "system",
      subtype: "task_started",
      task_id: "task-1",
      tool_use_id: "tool-1",
      description: "Inspect project",
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, context)).toEqual([
      expect.objectContaining({ type: "runtime.patch" }),
      {
        type: "conversation.update-tool",
        toolUseId: "tool-1",
        patch: { lifecycle: "running" },
      },
      {
        type: "task.upsert",
        task: {
          sessionId,
          taskId: "task-1",
          name: "Inspect project",
          status: "running",
          foreground: true,
          toolUseId: "tool-1",
        },
      },
    ]);
  });

  it("projects Task patches without inventing unchanged fields", () => {
    const message = {
      type: "system",
      subtype: "task_updated",
      task_id: "task-1",
      patch: {
        status: "paused",
        is_backgrounded: true,
      },
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      {
        type: "task.patch",
        taskId: "task-1",
        patch: { status: "paused", foreground: false },
      },
    ]);
  });

  it("projects the complete background Task replacement, including empty sets", () => {
    const changed = {
      type: "system",
      subtype: "background_tasks_changed",
      tasks: [{
        task_id: "task-background",
        task_type: "agent",
        description: "Inspect dependencies",
      }],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;
    const empty = { ...changed, tasks: [] } satisfies SDKMessage;

    expect(projectSdkMessage(changed, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      {
        type: "background-tasks.replace",
        tasks: [{
          sessionId,
          taskId: "task-background",
          name: "Inspect dependencies",
          status: "running",
          foreground: false,
        }],
      },
    ]);
    expect(projectSdkMessage(empty, {
      ...context,
      includeRawEvents: false,
    })).toEqual([{ type: "background-tasks.replace", tasks: [] }]);
  });

  it("projects SDK Session title changes", () => {
    const message = {
      type: "system",
      subtype: "session_title_changed",
      title: "Inspect the repository",
      source: "ai",
      revision: 1,
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(message, {
      ...context,
      includeRawEvents: false,
    })).toEqual([
      { type: "session.title-changed", title: "Inspect the repository" },
    ]);
  });

  it("projects SDK Session state changes as lifecycle actions", () => {
    for (const state of ["running", "requires_action", "idle"] as const) {
      const message = {
        type: "system",
        subtype: "session_state_changed",
        state,
        uuid: itemId,
        session_id: sessionId,
      } satisfies SDKMessage;
      expect(projectSdkMessage(message, {
        ...context,
        includeRawEvents: false,
      })).toEqual([{ type: "session.state", state }]);
    }
  });

  it("normalizes SDK Hook lifecycle events with stable provenance", () => {
    const messages = [
      {
        type: "system",
        subtype: "hook_started",
        hook_id: "hook-1",
        hook_name: "observe-tool",
        hook_event: "PreToolUse",
        uuid: itemId,
        session_id: sessionId,
      },
      {
        type: "system",
        subtype: "hook_progress",
        hook_id: "hook-1",
        hook_name: "observe-tool",
        hook_event: "PreToolUse",
        uuid: itemId,
        session_id: sessionId,
      },
      {
        type: "system",
        subtype: "hook_response",
        hook_id: "hook-1",
        hook_name: "observe-tool",
        hook_event: "PreToolUse",
        outcome: "success",
        uuid: itemId,
        session_id: sessionId,
      },
    ] as unknown as SDKMessage[];

    expect(messages.flatMap((message) =>
      projectSdkMessage(message, {
        ...context,
        includeRawEvents: false,
      })
    )).toEqual([
      {
        type: "runtime.patch",
        patch: {
          hooks: [{
            source: "sdk-event",
            event: "PreToolUse",
            phase: "started",
            hookId: "hook-1",
            hookName: "observe-tool",
            occurredAt: "2026-08-14T08:00:00.000Z",
          }],
        },
      },
      {
        type: "runtime.patch",
        patch: {
          hooks: [{
            source: "sdk-event",
            event: "PreToolUse",
            phase: "progress",
            hookId: "hook-1",
            hookName: "observe-tool",
            occurredAt: "2026-08-14T08:00:00.000Z",
          }],
        },
      },
      {
        type: "runtime.patch",
        patch: {
          hooks: [{
            source: "sdk-event",
            event: "PreToolUse",
            phase: "completed",
            hookId: "hook-1",
            hookName: "observe-tool",
            outcome: "success",
            occurredAt: "2026-08-14T08:00:00.000Z",
          }],
        },
      },
    ]);
  });

  it("redacts free-form permission denial messages", () => {
    const message = {
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      tool_use_id: "tool-bash",
      message: [
        "The command is not allowed.",
        "Authorization: Bearer permission-secret",
        "    at run (/private/permission-stack-secret.ts:12:4)",
      ].join("\n"),
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    const projection = projectSdkMessage(message, {
      ...context,
      includeRawEvents: false,
    });
    expect(projection).toContainEqual({
      type: "conversation.add",
      item: expect.objectContaining({
        kind: "error",
        error: expect.objectContaining({
          code: "TOOL_PERMISSION_DENIED",
          message: expect.stringContaining("The command is not allowed."),
        }),
      }),
    });
    expect(JSON.stringify(projection)).not.toContain("permission-secret");
    expect(JSON.stringify(projection)).not.toContain("permission-stack-secret");
  });

  it("projects result completion and additive unknown events safely", () => {
    const result = {
      type: "result",
      subtype: "success",
      result: "Done",
      uuid: itemId,
      session_id: sessionId,
    } as unknown as SDKMessage;
    const unknown = {
      type: "future_event",
      token: "secret",
      uuid: itemId,
      session_id: sessionId,
    } as unknown as SDKMessage;

    expect(projectSdkMessage(result, context)).toEqual([
      expect.objectContaining({
        type: "runtime.patch",
        patch: {
          rawEvents: [expect.objectContaining({
            messageType: "result.success",
            occurredAt: "2026-08-14T08:00:00.000Z",
          })],
        },
      }),
      { type: "turn.completed", success: true },
    ]);
    expect(projectSdkMessage(unknown, context)).toEqual([
      {
        type: "runtime.patch",
        patch: {
          rawEvents: [expect.objectContaining({
            messageType: "future_event",
            occurredAt: "2026-08-14T08:00:00.000Z",
          payload: expect.objectContaining({ token: "[REDACTED]" }),
          })],
        },
      },
    ]);
  });

  it("routes ordinary system status to timestamped runtime diagnostics", () => {
    const status = {
      type: "system",
      subtype: "status",
      status: "compacting",
      uuid: itemId,
      session_id: sessionId,
    } as unknown as SDKMessage;

    expect(projectSdkMessage(status, context)).toEqual([
      {
        type: "runtime.patch",
        patch: {
          rawEvents: [
            {
              messageType: "system.status",
              occurredAt: "2026-08-14T08:00:00.000Z",
              payload: expect.objectContaining({
                type: "system",
                subtype: "status",
              }),
            },
          ],
        },
      },
    ]);
  });

  it("projects the CLI version reported by a real SDK init message", () => {
    const init = {
      type: "system",
      subtype: "init",
      apiKeySource: "none",
      qodercli_version: "1.1.20",
      cwd: "/repo",
      tools: [],
      mcp_servers: [],
      model: "fixture-model",
      permissionMode: "default",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKMessage;

    expect(projectSdkMessage(init, context)).toEqual([
      {
        type: "runtime.patch",
        patch: {
          rawEvents: [
            expect.objectContaining({
              messageType: "system.init",
              occurredAt: "2026-08-14T08:00:00.000Z",
            }),
          ],
        },
      },
      {
        type: "runtime.patch",
        patch: { versions: { cli: "1.1.20" } },
      },
    ]);
  });

  it("uses the first non-empty SDK result cause and only safe structured details", () => {
    const secrets = [
      "bearer-secret",
      "session-secret",
      "preference-secret",
      "credential-secret",
      "password-secret",
      "password-suffix",
      "api-key-secret",
      "access-token-secret",
      "client-secret",
      "private-key-secret",
      "firefox-stack-secret",
      "safari-stack-secret",
      "quoted-cookie-secret",
      "quoted-preference-secret",
      "quoted-credential-secret",
      "quoted-password-secret",
      "quoted-api-secret",
      "quoted-access-secret",
      "quoted-client-secret",
      "quoted-private-secret",
      "resource-stack-secret",
      "webpack-stack-secret",
      "native-stack-secret",
      "file-stack-secret",
      "qoder-api-key-secret",
      "query-token-secret",
      "url-token-secret",
      "auth-header-secret",
      "qoder-client-secret",
      "raw-qoder-api-key-secret",
      "raw-auth-token-secret",
      "dotted-api-key-secret",
      "dotted-token-secret",
      "dotted-auth-token-secret",
      "dollar-api-key-secret",
      "bracket-api-key-secret",
      "bracket-auth-token-secret",
      "flattened-api-key-secret",
      "flattened-auth-token-secret",
      "flattened-token-secret",
    ];
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [
        [
          "Model is not available for this account.",
          "Unable to resolve @scope/pkg:123",
          "Contact support@example.com:123",
          "Keep ordinary @mention:42",
          '{"config.QODER_API_KEY":"flattened-api-key-secret"}',
          '{"headers.X-Auth-Token":"flattened-auth-token-secret"}',
          '{"query.token":"flattened-token-secret"}',
          "Authorization: Bearer bearer-secret",
          "Cookie: session=session-secret; preference=preference-secret",
          "credential=credential-secret&retry=true",
          "password=password-secret password-suffix; operation=model",
          "apiKey=api-key-secret&source=query",
          "accessToken=access-token-secret, operation=model",
          "clientSecret=client-secret; operation=model",
          "privateKey=private-key-secret; operation=model",
          "request@https://firefox-stack-secret.example/app.js:10:2",
          "global code@https://safari-stack-secret.example/app.js:12:4",
          '{"Cookie":"session=quoted-cookie-secret; preference=quoted-preference-secret"}',
          '{"credential":"quoted-credential-secret"}',
          '{"password":"quoted-password-secret"}',
          '{"apiKey":"quoted-api-secret"}',
          '{"accessToken":"quoted-access-secret"}',
          '{"clientSecret":"quoted-client-secret"}',
          '{"privateKey":"quoted-private-secret"}',
          "load@resource://gre/resource-stack-secret.js:10:2",
          "dispatch@webpack-internal://app/webpack-stack-secret.js:12:4",
          "native-stack-secret@[native code]",
          "@file:///private/file-stack-secret.js:10:2",
          "QODER_API_KEY=qoder-api-key-secret&retry=true",
          "token=query-token-secret&next=/models",
          "https://example.test/models?token=url-token-secret&mode=list",
          "X-Auth-Token: auth-header-secret, trace=visible-trace",
          "QODER_CLIENT_SECRET=qoder-client-secret; retry=true",
          "config.QODER_API_KEY=dotted-api-key-secret&retry=true",
          "query.token=dotted-token-secret&retry=true",
          "headers.X-Auth-Token=dotted-auth-token-secret, trace=visible",
          "$QODER_API_KEY=dollar-api-key-secret&retry=true",
          'config["QODER_API_KEY"]=bracket-api-key-secret&retry=true',
          "headers['X-Auth-Token']=bracket-auth-token-secret, trace=visible",
        ].join("\n"),
        "Later cause",
      ],
      error_code: 4103,
      terminal_reason: "model_unavailable",
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
      stack: "credential=secret-stack",
      access_token: "secret-token",
      QODER_API_KEY: "raw-qoder-api-key-secret",
      X_AUTH_TOKEN: "raw-auth-token-secret",
    } satisfies SDKResultError & {
      stack: string;
      access_token: string;
      QODER_API_KEY: string;
      X_AUTH_TOKEN: string;
    };

    expect(projectSdkMessage(message, context)).toContainEqual({
      type: "conversation.add",
      item: expect.objectContaining({
        kind: "error",
        error: {
          code: "SDK_RESULT_ERROR",
        message: expect.stringContaining(
          "Model is not available for this account.",
        ),
          retryable: true,
          details: {
            subtype: "error_during_execution",
            error_code: 4103,
            terminal_reason: "model_unavailable",
          },
        },
      }),
    });
    const projection = projectSdkMessage(message, context);
    const projected = JSON.stringify(projection);
    for (const secret of secrets) expect(projected).not.toContain(secret);
    expect(projected).toContain("Model is not available for this account.");
    expect(projected).toContain("Unable to resolve @scope/pkg:123");
    expect(projected).toContain("Contact support@example.com:123");
    expect(projected).toContain("Keep ordinary @mention:42");
    expect(projected).not.toContain("secret-stack");
    expect(projected).not.toContain("secret-token");
    expect(JSON.stringify(projection[1])).not.toContain("Later cause");
    for (const secret of [
      "flattened-api-key-secret",
      "flattened-auth-token-secret",
      "flattened-token-secret",
    ]) {
      expect(JSON.stringify(projection[0])).not.toContain(secret);
      expect(JSON.stringify(projection[1])).not.toContain(secret);
    }
  });

  it("removes only real V8 stack frames from a concrete SDK cause", () => {
    const stackSecrets = [
      "v8-url-secret",
      "v8-file-secret",
      "v8-unix-secret",
      "v8-windows-secret",
      "node:internal/process/task_queues",
      "native code",
    ];
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [[
        "Keep this concrete cause.",
        "at @scope/pkg:123",
        "at least one ordinary explanation",
        "    at run (https://v8-url-secret.example/app.js:10:2)",
        "    at file:///private/v8-file-secret.js:11:3",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
        "    at /Users/sample/v8-unix-secret.ts:12:4",
        "    at run (C:\\repo\\v8-windows-secret.ts:13:5)",
        "    at run ([native code])",
      ].join("\n")],
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const projected = JSON.stringify(projectSdkMessage(message, context));
    expect(projected).toContain("Keep this concrete cause.");
    expect(projected).toContain("at @scope/pkg:123");
    expect(projected).toContain("at least one ordinary explanation");
    for (const secret of stackSecrets) expect(projected).not.toContain(secret);
  });

  it("builds result-error diagnostics only from proven-safe fields", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: ["Model endpoint is unavailable for this account."],
      error_code: 4103,
      terminal_reason: [
        "model_unavailable",
        'payload="{\\\"config.QODER_API_KEY\\\":\\\"terminal-flat-secret\\\"}"',
        "    at run (src/terminal-stack-secret.ts:12:4)",
      ].join("\n"),
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
      unproven_diagnostic: "unproven-raw-secret",
    } satisfies SDKResultError & { unproven_diagnostic: string };

    const projection = projectSdkMessage(message, context);
    const runtime = projection[0];
    expect(runtime).toMatchObject({ type: "runtime.patch" });
    if (runtime?.type !== "runtime.patch") return;
    expect(runtime.patch.rawEvents?.[0]?.payload).toEqual({
      type: "result",
      subtype: "error_during_execution",
      error_code: 4103,
      summary: "Model endpoint is unavailable for this account.",
      terminal_reason: "model_unavailable",
    });
    expect(JSON.stringify(projection)).not.toContain("terminal-flat-secret");
    expect(JSON.stringify(projection)).not.toContain("terminal-stack-secret");
    expect(JSON.stringify(projection)).not.toContain("unproven-raw-secret");
  });

  it("skips an escaped nested credential cause and keeps the first safe cause", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [
        'payload="{\\\"config.QODER_API_KEY\\\":\\\"nested-flat-secret\\\"}"',
        "Model endpoint is unavailable for this account.",
      ],
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const projection = projectSdkMessage(message, context);
    const turn = projection.find((action) => action.type === "turn.completed");
    expect(turn).toMatchObject({
      type: "turn.completed",
      success: false,
      error: { message: "Model endpoint is unavailable for this account." },
    });
    expect(JSON.stringify(projection)).not.toContain("nested-flat-secret");
  });

  it("rejects bounded encoded credential references from every error surface", () => {
    const encodedCauses = [
      String.raw`payload={\"config.QODER\u005fAPI\u005fKEY\":\"unicode-secret\"}`,
      String.raw`Bearer\u0020bearer-secret`,
      String.raw`?\x74oken=hex-secret`,
      "?%74oken=percent-secret",
      "?%2574oken=layered-percent-secret",
      String.raw`payload=\u00ZZmalformed-secret`,
      "?%2525252574oken=overdeep-secret",
    ];
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [...encodedCauses, "Safe model endpoint cause."],
      terminal_reason: [...encodedCauses, "safe_terminal_reason"].join("\n"),
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const projection = projectSdkMessage(message, context);
    const runtime = projection[0];
    const transcript = projection.find(
      (action) => action.type === "conversation.add",
    );
    const turn = projection.find((action) => action.type === "turn.completed");
    expect(runtime).toMatchObject({ type: "runtime.patch" });
    expect(transcript).toMatchObject({
      type: "conversation.add",
      item: {
        error: {
          message: "Safe model endpoint cause.",
          details: { terminal_reason: "safe_terminal_reason" },
        },
      },
    });
    expect(turn).toMatchObject({
      type: "turn.completed",
      success: false,
      error: {
        message: "Safe model endpoint cause.",
        details: { terminal_reason: "safe_terminal_reason" },
      },
    });
    for (const surface of [runtime, transcript, turn]) {
      const rendered = JSON.stringify(surface);
      for (const marker of [
        "unicode-secret",
        "bearer-secret",
        "hex-secret",
        "percent-secret",
        "layered-percent-secret",
        "malformed-secret",
        "overdeep-secret",
      ]) expect(rendered).not.toContain(marker);
    }
  });

  it("removes V8, Gecko, and WebKit path frames without hiding ordinary at-sign text", () => {
    const stackSecrets = [
      "v8-relative-stack-secret",
      "gecko-url-stack-secret",
      "gecko-relative-stack-secret",
      "gecko-unix-stack-secret",
      "gecko-windows-stack-secret",
      "webkit-node-stack-secret",
      "webkit-native-stack-secret",
    ];
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [[
        "Keep this concrete cause.",
        "at @scope/pkg:123",
        "Contact support@example.com:123",
        "Keep ordinary @mention:42",
        "    at run (src/v8-relative-stack-secret.ts:10:2)",
        "run@https://example.test/gecko-url-stack-secret.js:11:3",
        "run@src/gecko-relative-stack-secret.ts:12:4",
        "run@/repo/gecko-unix-stack-secret.ts:13:5",
        "run@C:\\repo\\gecko-windows-stack-secret.ts:14:6",
        "run@node:internal/webkit-node-stack-secret:15:7",
        "run@webkit-native-stack-secret@[native code]",
      ].join("\n")],
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const projected = JSON.stringify(projectSdkMessage(message, context));
    expect(projected).toContain("Keep this concrete cause.");
    expect(projected).toContain("at @scope/pkg:123");
    expect(projected).toContain("support@example.com:123");
    expect(projected).toContain("@mention:42");
    for (const secret of stackSecrets) expect(projected).not.toContain(secret);
  });

  it("removes a recognized location nested inside a V8 eval frame", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: [[
        "Keep this eval cause.",
        "at @scope/pkg:123",
        "at eval (eval at run (file:///private/v8-eval-secret.js:1:2), <anonymous>:3:4)",
      ].join("\n")],
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const projected = JSON.stringify(projectSdkMessage(message, context));
    expect(projected).toContain("Keep this eval cause.");
    expect(projected).toContain("at @scope/pkg:123");
    expect(projected).not.toContain("v8-eval-secret");
    expect(projected).not.toContain("<anonymous>:3:4");
  });

  it("falls back to a Chinese explanation when SDK result causes are empty", () => {
    const message = {
      type: "result",
      subtype: "error_max_turns",
      errors: ["", "  ", "    at secretStack (/private/credentials.ts:1:1)"],
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 3,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    expect(projectSdkMessage(message, context)).toContainEqual({
      type: "turn.completed",
      success: false,
      error: expect.objectContaining({
        message: "SDK 已达到最大轮次限制。",
      }),
    });
  });

  it("bounds SDK result messages and terminal reasons before browser projection", () => {
    const message = {
      type: "result",
      subtype: "error_during_execution",
      errors: ["界".repeat(5_000)],
      terminal_reason: "reason".repeat(500),
      duration_ms: 10,
      duration_api_ms: 8,
      is_error: true,
      num_turns: 1,
      stop_reason: null,
      total_cost_usd: 0,
      usage,
      modelUsage: {},
      permission_denials: [],
      uuid: itemId,
      session_id: sessionId,
    } satisfies SDKResultError;

    const turn = projectSdkMessage(message, context).find(
      (action) => action.type === "turn.completed",
    );
    expect(turn).toMatchObject({ type: "turn.completed", success: false });
    if (turn?.type !== "turn.completed" || turn.error === undefined) return;
    expect(turn.error.message.length).toBeLessThan(5_000);
    expect(turn.error.message).toMatch(/…$/);
    expect(String(turn.error.details?.terminal_reason).length).toBeLessThan(
      message.terminal_reason.length,
    );
  });
});
