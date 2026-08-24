import { randomUUID } from "node:crypto";
import type {
  ModelUsage,
  NonNullableUsage,
  SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";
import type { CreateQueryInput, QueryFactory } from "../../src/server/sdk/query-factory.js";
import type { QueryMessage, QueryPort } from "../../src/server/sdk/query-port.js";
import type { FixtureSessionCatalog } from "./fake-sdk-runtime.js";

class OutputQueue implements AsyncIterable<QueryMessage> {
  readonly #values: QueryMessage[] = [];
  readonly #waiters: Array<(value: IteratorResult<QueryMessage>) => void> = [];
  #ended = false;

  push(value: QueryMessage): void {
    if (this.#ended) return;
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#values.push(value);
    else waiter({ done: false, value });
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const waiter of this.#waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<QueryMessage> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value !== undefined) return Promise.resolve({ done: false, value });
        if (this.#ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function queryMessage<Message extends SDKMessage>(value: Message): Message {
  return value;
}

const fixtureUsage = {
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: "local",
  input_tokens: 96,
  iterations: [],
  output_tokens: 32,
  server_tool_use: {
    web_fetch_requests: 0,
    web_search_requests: 0,
  },
  service_tier: "fixture",
  speed: "standard",
} satisfies NonNullableUsage;

const fixtureModelUsage = {
  "fixture-model": {
    inputTokens: 96,
    outputTokens: 32,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 32_768,
    maxOutputTokens: 8_192,
  },
} satisfies Record<string, ModelUsage>;

function messageText(message: Awaited<ReturnType<AsyncIterator<unknown>["next"]>>["value"]): string {
  if (typeof message !== "object" || message === null || !("message" in message)) return "";
  const content = (message as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      block.type === "text" &&
      "text" in block &&
      typeof block.text === "string"
        ? block.text
        : "",
    )
    .join("");
}

const fixtureSkills = [
  { name: "fixture-inspect", description: "Inspect the deterministic fixture." },
  { name: "sample-architecture", description: "Review the sample architecture." },
  { name: "sample-checkpoint", description: "Exercise Checkpoint behavior." },
  { name: "sample-credits", description: "Inspect Credits projection." },
  { name: "sample-errors", description: "Exercise safe error handling." },
  { name: "sample-hooks", description: "Inspect Hooks events." },
  { name: "sample-mcp", description: "Exercise MCP interactions." },
  { name: "sample-messages", description: "Inspect the message stream." },
  { name: "sample-permissions", description: "Exercise approval flows." },
  { name: "sample-resume", description: "Exercise Session resume." },
  { name: "sample-session", description: "Inspect Session state." },
  { name: "sample-tasks", description: "Inspect Task events." },
  { name: "sample-tools", description: "Exercise tool cards." },
];

const fixtureCommands = fixtureSkills.map((skill) => ({
  ...skill,
  argumentHint: skill.name === "fixture-inspect" ? "[path]" : "",
}));

const fixtureModels = [
  {
    value: "fixture-model",
    displayName: "Fixture model",
    description: "Deterministic model for browser acceptance tests.",
    isDefault: true,
  },
];

/** Deterministic QueryPort that exercises the production orchestration stack. */
export class FakeQuery implements QueryPort {
  readonly #sessionId: string;
  readonly #input: CreateQueryInput;
  readonly #catalog: FixtureSessionCatalog;
  readonly #output = new OutputQueue();
  readonly #abort = new AbortController();
  #closed = false;

  constructor(options: {
    sessionId: string;
    input: CreateQueryInput;
    catalog: FixtureSessionCatalog;
  }) {
    this.#sessionId = options.sessionId;
    this.#input = options.input;
    this.#catalog = options.catalog;
    void this.#consume();
  }

  [Symbol.asyncIterator](): AsyncIterator<QueryMessage> {
    return this.#output[Symbol.asyncIterator]();
  }

  initializationResult(): ReturnType<QueryPort["initializationResult"]> {
    return Promise.resolve({
      capabilities: ["session_rewind_v1", "interrupt_receipt_v1"],
      skills: fixtureSkills,
      commands: fixtureCommands,
      models: fixtureModels,
    }) as ReturnType<QueryPort["initializationResult"]>;
  }

  interrupt(): ReturnType<QueryPort["interrupt"]> {
    return Promise.resolve(undefined);
  }

  async cancelAsyncMessage(): Promise<boolean> {
    return true;
  }

  async stopTask(): Promise<void> {}

  async backgroundTasks(): Promise<boolean> {
    return true;
  }

  async setPermissionMode(): Promise<void> {}

  async setModel(): Promise<void> {}

  addDirectories(
    directories: string[],
  ): ReturnType<QueryPort["addDirectories"]> {
    return Promise.resolve({
      added: directories,
      failed: [],
      directories,
    });
  }

  mcpServerStatus(): ReturnType<QueryPort["mcpServerStatus"]> {
    return Promise.resolve([
      {
        name: "showcase_project",
        status: "connected",
        serverInfo: { name: "Fixture project tools", version: "1.0.0" },
        tools: [
          {
            name: "list_project_entries",
            description: "Lists top-level fixture project entries.",
          },
        ],
      },
    ]) as ReturnType<QueryPort["mcpServerStatus"]>;
  }

  mcpAuthenticate(): ReturnType<QueryPort["mcpAuthenticate"]> {
    return Promise.resolve({ requiresUserAction: false });
  }

  async mcpSubmitOAuthCallbackUrl(): Promise<void> {}

  getContextUsage(): ReturnType<QueryPort["getContextUsage"]> {
    return Promise.resolve({
      categories: [
        { name: "Fixture messages", tokens: 128, color: "#8b5cf6" },
      ],
      totalTokens: 128,
      maxTokens: 32_768,
      rawMaxTokens: 32_768,
      percentage: 0.39,
      gridRows: [],
      model: "fixture-model",
      memoryFiles: [],
      mcpTools: [
        {
          name: "list_project_entries",
          serverName: "showcase_project",
          tokens: 12,
          isLoaded: true,
        },
      ],
      agents: [],
      isAutoCompactEnabled: true,
      apiUsage: {
        input_tokens: 96,
        output_tokens: 32,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });
  }

  getUsageInfo(): ReturnType<QueryPort["getUsageInfo"]> {
    return Promise.resolve({
      userQuota: { total: 50, used: 8, remaining: 42, unit: "credits" },
      session: {
        total_credits: 8,
        model_usage: { "fixture-model": { credits: 8 } },
      },
    });
  }

  accountInfo(): ReturnType<QueryPort["accountInfo"]> {
    return Promise.resolve({
      name: "Fixture developer",
      subscriptionType: "local-test",
    });
  }

  getAvailableModels(): ReturnType<QueryPort["getAvailableModels"]> {
    return Promise.resolve(fixtureModels);
  }

  supportedCommands(): ReturnType<QueryPort["supportedCommands"]> {
    return Promise.resolve(fixtureCommands);
  }

  supportedAgents(): ReturnType<QueryPort["supportedAgents"]> {
    return Promise.resolve([
      { name: "fixture-researcher", description: "Synthetic subagent" },
    ]);
  }

  listPlugins(): ReturnType<QueryPort["listPlugins"]> {
    return Promise.resolve([
      {
        id: "fixture-plugin",
        name: "fixture-plugin",
        path: "/synthetic/fixture-plugin",
        source: "fixture",
        version: "1.0.0",
        scope: "project",
        enabled: true,
        canDisable: true,
        resources: {
          skills: [],
          agents: [],
          mcpServers: [],
          commands: [],
          hooks: [],
        },
      },
    ]);
  }

  reloadPlugins(): ReturnType<QueryPort["reloadPlugins"]> {
    return Promise.resolve({
      commands: [],
      agents: [],
      plugins: [],
      mcpServers: [],
      error_count: 0,
    });
  }

  generateSessionTitle(): ReturnType<QueryPort["generateSessionTitle"]> {
    return Promise.resolve("Fixture generated title");
  }

  rewindFiles(
    _userMessageId: string,
    _options?: { dryRun?: boolean },
  ): ReturnType<QueryPort["rewindFiles"]> {
    return Promise.resolve({
      canRewind: true,
      filesChanged: ["README.md"],
      insertions: 4,
      deletions: 1,
    }) as ReturnType<QueryPort["rewindFiles"]>;
  }

  rewind(
    userMessageId: string,
    options?: Parameters<QueryPort["rewind"]>[1],
  ): ReturnType<QueryPort["rewind"]> {
    const scope = options?.scope ?? "both";
    if (options?.dryRun !== true && scope !== "files") {
      this.#catalog.rewindConversation(this.#sessionId, userMessageId);
    }
    return Promise.resolve({
      status: options?.dryRun === true ? "ready" : "success",
      targetUserMessageId: userMessageId,
      scope,
      filesChanged: ["README.md"],
      insertions: 4,
      deletions: 1,
      failedFiles: [],
    }) as ReturnType<QueryPort["rewind"]>;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#output.end();
  }

  async #consume(): Promise<void> {
    try {
      for await (const message of this.#input.input) {
        if (this.#closed) return;
        const text = messageText(message);
        const messageId = message.uuid ?? randomUUID();
        if (message.shouldQuery === false) {
          this.#catalog.recordTurn({
            sessionId: this.#sessionId,
            messageId,
            text,
            assistantText: "Stored without running the fixture agent.",
          });
          continue;
        }
        await this.#scriptTurn(messageId, text);
      }
    } catch (error) {
      if (!this.#closed) {
        this.#output.push(
          queryMessage({
            type: "result",
            subtype: "error_during_execution",
            errors: [error instanceof Error ? error.message : "Fixture failure"],
            duration_ms: 0,
            duration_api_ms: 0,
            is_error: true,
            num_turns: 0,
            stop_reason: null,
            total_cost_usd: 0,
            usage: fixtureUsage,
            modelUsage: {},
            permission_denials: [],
            uuid: randomUUID(),
            session_id: this.#sessionId,
          }),
        );
      }
    }
  }

  async #scriptTurn(messageId: string, text: string): Promise<void> {
    const toolUseId = `tool-${randomUUID()}`;
    const streamId = randomUUID();
    for (const delta of ["正在", "检查项目", "…"]) {
      this.#output.push(
        queryMessage({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: delta },
          },
          parent_tool_use_id: null,
          uuid: streamId,
          session_id: this.#sessionId,
        }),
      );
    }
    this.#output.push(
      queryMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: toolUseId,
              name: "Write",
              input: { file_path: "README.md", content: "Synthetic change" },
            },
          ],
        },
        parent_tool_use_id: null,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );

    const agentToolUseId = `agent-${randomUUID()}`;
    const childToolUseId = `child-${randomUUID()}`;
    const childInstruction = "Find fixture MCP configuration examples";
    this.#output.push(
      queryMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: agentToolUseId,
            name: "Agent",
            input: { prompt: childInstruction, subagent_type: "Explore" },
          }],
        },
        parent_tool_use_id: null,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    const childMessages = [
      queryMessage({
        type: "user",
        message: { role: "user", content: childInstruction },
        parent_tool_use_id: agentToolUseId,
        isSynthetic: false,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
      queryMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{
            type: "tool_use",
            id: childToolUseId,
            name: "Glob",
            input: { pattern: "**/*.json" },
          }],
        },
        parent_tool_use_id: agentToolUseId,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
      queryMessage({
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: childToolUseId,
            content: "fixtures/mcp.json",
          }],
        },
        parent_tool_use_id: agentToolUseId,
        isSynthetic: true,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
      queryMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fixture Subagent finished." }],
        },
        parent_tool_use_id: agentToolUseId,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    ] satisfies SDKMessage[];
    for (const childMessage of childMessages) this.#output.push(childMessage);
    const timestamp = new Date().toISOString();
    this.#catalog.recordSubagent(
      this.#sessionId,
      "fixture-researcher",
      childMessages.map((childMessage) => ({
        type: childMessage.type === "assistant" ? "assistant" : "user",
        id: childMessage.uuid,
        sessionId: this.#sessionId,
        message: childMessage.message,
        parentToolUseId: agentToolUseId,
        timestamp,
      })),
    );
    this.#output.push(
      queryMessage({
        type: "user",
        message: {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: agentToolUseId,
            content: "Fixture Subagent finished.",
          }],
        },
        parent_tool_use_id: null,
        isSynthetic: true,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );

    await this.#input.interactions.canUseTool(() => this.#sessionId)(
      "Write",
      { file_path: "README.md", content: "Synthetic change" },
      { signal: this.#abort.signal, toolUseID: toolUseId },
    );
    this.#output.push(
      queryMessage({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolUseId,
              content: "Fixture write approved",
            },
          ],
        },
        parent_tool_use_id: null,
        isSynthetic: true,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );

    await this.#input.interactions.canUseTool(() => this.#sessionId)(
      "AskUserQuestion",
      {
        questions: [
          {
            header: "Scope",
            question: "How should the fixture inspect the project?",
            options: [
              { label: "Focused", description: "Inspect the top-level files." },
              { label: "Broad", description: "Inspect every fixture area." },
            ],
            multiSelect: false,
          },
        ],
      },
      { signal: this.#abort.signal, toolUseID: `question-${randomUUID()}` },
    );

    const elicitation = await this.#input.interactions.onElicitation(
      () => this.#sessionId,
    )(
      {
        serverName: "showcase_project",
        message: "Confirm the read-only MCP project listing.",
        mode: "form",
        requestedSchema: {
          type: "object",
          properties: {
            confirmed: {
              type: "boolean",
              title: "确认只读访问",
              description: "允许 fixture 读取项目目录。",
            },
          },
          required: ["confirmed"],
        },
      },
      { signal: this.#abort.signal },
    );
    if (
      elicitation.action === "accept" &&
      elicitation.content !== undefined
    ) {
      this.#catalog.recordElicitation(this.#sessionId, elicitation.content);
    }

    this.#output.push(
      queryMessage({
        type: "system",
        subtype: "hook_response",
        hook_id: `hook-${randomUUID()}`,
        hook_name: "FixtureSessionStart",
        hook_event: "SessionStart",
        output: "Fixture hook completed.",
        stdout: "Fixture hook completed.\n",
        stderr: "",
        outcome: "success",
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    this.#output.push(
      queryMessage({
        type: "user",
        message: {
          role: "user",
          content: [
            "<task-notification>",
            "<task-id>fixture-index</task-id>",
            `<tool-use-id>${toolUseId}</tool-use-id>`,
            "<output-file>/tmp/fixture-index.output</output-file>",
            "<status>completed</status>",
            "<summary>Fixture background task completed</summary>",
            "</task-notification>",
          ].join("\n"),
        },
        parent_tool_use_id: null,
        isSynthetic: false,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    this.#output.push(
      queryMessage({
        type: "system",
        subtype: "task_started",
        task_id: "fixture-index",
        description: "Index fixture project",
        tool_use_id: toolUseId,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    this.#output.push(
      queryMessage({
        type: "prompt_suggestion",
        suggestion: [
          "查看 MCP 配置示例",
          "运行登录测试",
          "检查项目目录",
        ].join("\n"),
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    const assistantText = "项目检查已完成。";
    this.#output.push(
      queryMessage({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: assistantText }],
        },
        parent_tool_use_id: null,
        uuid: randomUUID(),
        session_id: this.#sessionId,
      }),
    );
    this.#catalog.recordTurn({
      sessionId: this.#sessionId,
      messageId,
      text,
      assistantText,
    });
    this.#output.push(
      queryMessage({
        type: "result",
        subtype: "success",
        result: assistantText,
        uuid: randomUUID(),
        session_id: this.#sessionId,
        duration_ms: 25,
        duration_api_ms: 10,
        is_error: false,
        num_turns: 1,
        stop_reason: "end_turn",
        total_cost_usd: 0,
        usage: fixtureUsage,
        modelUsage: fixtureModelUsage,
        permission_denials: [],
      }),
    );
  }
}

/** Creates fixture Queries while preserving the production factory interface. */
export function createFakeQueryFactory(
  catalog: FixtureSessionCatalog,
): QueryFactory {
  return {
    create(input) {
      const sessionId = input.newSessionId ?? input.resumeSessionId ?? input.getSessionId();
      catalog.ensureSession(input.workspacePath, sessionId);
      return new FakeQuery({ sessionId, input, catalog });
    },
  };
}
