# SDK 适配层

[`src/server/sdk/`](.) 是本示例中唯一 import `@qoder-ai/qoder-agent-sdk` 的位置。该边界由 `npm run check:boundary`（`scripts/check-sdk-import-boundary.mjs`）强制：其余各层（`api/`、`services/`、`client/`、`shared/`）均不依赖 SDK。

学习本示例如何调用 SDK 时，从这里读起。下方每个文件对应一项 SDK 能力。

## 如何通过本目录学习 SDK

1. 从 [`query-factory.ts`](query-factory.ts) 读起：它是 `query()` 的调用点，几乎展示了 `Options` 的每一个字段。
2. 想了解某项能力，在下表找到对应文件，打开后阅读它如何调用所列的 SDK 符号。
3. SDK 公开导出的权威清单见 SDK 自身的 `src/index.ts`。

## SDK 能力地图

### query() 入口与选项

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`query-factory.ts`](query-factory.ts) | `query`, `Options`, `AuthOptions`, `PermissionMode`, `Query`, `SDKUserMessage` | `query()` 调用点；传入 auth、cwd、sessionId、model、permissionMode、enableFileCheckpointing、includePartialMessages、includeHookEvents、promptSuggestions、canUseTool、onElicitation、mcpServers、hooks、resume、forkSession |
| [`query-port.ts`](query-port.ts) | `Query`, `SDKMessage`, `PermissionMode`, `BYOKModelValidationInput`, `RewindScope`, `Settings` | 将 showcase 的 `QueryPort` 接口逐方法镜像 SDK `Query`；`adaptQuery` 把真实 `Query` 适配为该接口 |

### 认证

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`query-factory.ts`](query-factory.ts) | `qodercliAuth`, `accessTokenFromEnv`, `AuthOptions` | 依据 `QODER_WEBUI_AUTH` 选择 `qodercliAuth()` 或 `accessTokenFromEnv()` |

### 进程内 MCP

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`demo-mcp-server.ts`](demo-mcp-server.ts) | `createSdkMcpServer`, `tool`, `CallToolResult` | 用一个 `tool` 构建只读的 `showcase_project` 进程内 MCP 服务器 |
| [`mcp-service.ts`](mcp-service.ts) | `McpServerStatus` | 将 `Query.mcpServerStatus()` 投影为浏览器视图模型 |
| [`mcp-config.ts`](mcp-config.ts) | `McpServerConfig`, `McpStdioServerConfig`, `McpSSEServerConfig`, `McpHttpServerConfig`, `McpServerToolPolicy` | 从 `QODER_WEBUI_MCP_CONFIG_FILE` 解析服务端 MCP 配置 |

### 会话管理

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`sdk-public-contract.ts`](sdk-public-contract.ts) | `listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `renameSession`, `tagSession`, `forkSession`, `deleteSession` | 将 SDK 会话函数集中为可注入契约（便于测试替换 fake） |
| [`session-catalog.ts`](session-catalog.ts) | `SDKSessionInfo`, `SessionMessage`（加上上述契约） | 调用 SDK 会话函数来列出、读取、重命名、分叉、删除会话与子代理历史 |

### 消息投影

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`message-projector.ts`](message-projector.ts) | `SDKMessage`, `SDKResultError` | 将实时 `SDKMessage` 流投影为语义化的 `ProjectionAction`（assistant / user / stream_event / result / system） |
| [`history-projector.ts`](history-projector.ts) | 经 `getSessionMessages` 消费 `SessionMessage` | 从 SDK 会话历史恢复转录，投影为 `ConversationItem` |
| [`product-user-message.ts`](product-user-message.ts) | 过滤 SDK 控制回执 | 把 SDK 命令/任务回执排除在产品用户文本之外 |

### Hooks

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`hooks.ts`](hooks.ts) | `HookCallback`, `HookJSONOutput`, `Options` | 为 SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop 构造 `Options["hooks"]` |

### Approval、AskUser、elicitation

| 文件 | SDK 符号 | 展示内容 |
| --- | --- | --- |
| [`interaction-broker.ts`](interaction-broker.ts) | `CanUseTool`, `OnElicitation`, `ElicitationResult`, `PermissionResult`, `PermissionUpdate` | 实现传入 `query()` 选项的 `canUseTool` 与 `onElicitation` 回调 |
| [`input-queue.ts`](input-queue.ts) | `SDKUserMessage` | 以 `AsyncIterable<SDKUserMessage>` 形式向 SDK 喂入用户输入 |

### 运行时能力（经 `QueryPort` 消费）

这些文件不直接 import SDK 符号，而是通过 [`query-port.ts`](query-port.ts) 声明的 `QueryPort` 接口（镜像 `Query`）调用 SDK `Query` 的运行时方法：

| 文件 | 调用的 `Query`/`QueryPort` 方法 |
| --- | --- |
| [`session-controller.ts`](session-controller.ts) | 驱动 `Query` 异步迭代器、`interrupt`、生命周期阶段 |
| [`runtime-capability-service.ts`](runtime-capability-service.ts) | `accountInfo`、`getUsageInfo`、`getAvailableModels`、`supportedCommands`、`supportedAgents` |
| [`checkpoint-service.ts`](checkpoint-service.ts) | `rewind`、`rewindFiles` |

### 浏览器安全投影辅助

这些文件不调用 SDK，而是在 SDK 值到达浏览器前进行脱敏与限量：

| 文件 | 职责 |
| --- | --- |
| [`redact.ts`](redact.ts) | 结构化、按字节预算的深度脱敏器（`redactForBrowser`、`safeRawPayload`） |
| [`error-text-redact.ts`](error-text-redact.ts) | 自由格式 SDK 错误文本脱敏（`boundedErrorText`） |
| [`browser-projection.ts`](browser-projection.ts) | 将 SDK 值投影为脱敏的浏览器安全记录 |
