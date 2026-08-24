# SDK 适配层维护说明

[`src/server/sdk/`](.) 是本样板中唯一允许 import `@qoder-ai/qoder-agent-sdk` 的目录。该边界由 [`scripts/check-sdk-import-boundary.mjs`](../../../scripts/check-sdk-import-boundary.mjs) 强制；`api/`、`services/`、`shared/` 和 `client/` 只依赖应用自己的 port、command、event 与 view model。

面向第一次使用 SDK 的完整示例见 [SDK 快速开始](../../../docs/SDK_QUICK_START.md)；端到端架构见 [SDK 代码导览](../../../docs/SDK_CODE_TOUR.md)；安装和运行见[包根 README](../../../README.md)。本页只作为修改 adapter 时的共置索引。

## 阅读顺序

1. [`query-factory.ts`](query-factory.ts)：应用唯一的 `query()` 构造点，组合 auth、`cwd`、Session 意图、Model、Permission、Checkpoint、partial message、Hooks、MCP 与交互 callback。
2. [`query-port.ts`](query-port.ts)：产品实际消费的公开 `Query` 方法子集；`adaptQuery()` 是真实 Query 进入应用的接缝。
3. [`input-queue.ts`](input-queue.ts) 与 [`session-controller.ts`](session-controller.ts)：一个长生命周期 Query 的输入、输出、Session state、interrupt/cancel 与关闭。
4. [`message-projector.ts`](message-projector.ts) 与 [`history-projector.ts`](history-projector.ts)：live/history 语义投影。
5. 按下面的能力地图进入具体 adapter。

`QueryPort` **不是**完整 SDK Query 的镜像，也不是能力目录。只有 service/controller 实际调用并且有产品策略与测试的方法才进入该接口；完整公共合同以当前安装的 `@qoder-ai/qoder-agent-sdk` 包导出类型和官方 SDK 参考为准。

## 能力地图

### Query、认证与 Session 意图

| 文件 | SDK 公共符号 | 本层职责 |
| --- | --- | --- |
| [`query-factory.ts`](query-factory.ts) | `query`、`Options`、`AuthOptions`、`qodercliAuth`、`accessTokenFromEnv`、`SDKUserMessage` | 选择认证；传入 `cwd`、`sessionId` / `resume` / `forkSession` 与运行时 options |
| [`query-port.ts`](query-port.ts) | `Query`、`SDKMessage`、`PermissionMode`、`RewindScope` | 声明应用当前消费的最小 Query 子集；不重新实现 SDK 行为 |
| [`sdk-public-contract.ts`](sdk-public-contract.ts) | `listSessions`、`getSessionInfo`、`getSessionMessages`、`getSubagentMessages`、`listSubagents`、`renameSession`、`tagSession`、`forkSession`、`deleteSession` | 把公开 Session 函数集中为可注入合同 |
| [`session-catalog.ts`](session-catalog.ts) | `SDKSessionInfo`、`SessionMessage` 与上述函数 | 列出、读取、恢复、重命名、Fork、删除 Session 和读取 Subagent 历史 |

### 长生命周期 Query 与消息

| 文件 | SDK 公共符号/方法 | 本层职责 |
| --- | --- | --- |
| [`input-queue.ts`](input-queue.ts) | `SDKUserMessage` | 实现 `AsyncIterable<SDKUserMessage>`，保留 `uuid`、`priority`、`shouldQuery` 与本地取消状态 |
| [`session-controller.ts`](session-controller.ts) | `Query` 异步迭代、`initializationResult`、`interrupt`、`cancelAsyncMessage`、`close` | 消费输出；以 SDK Session state 为主协调生命周期；管理 fatal/close |
| [`message-projector.ts`](message-projector.ts) | `SDKMessage`、`SDKResultError` | 把 live Assistant/Tool/Task/Hook/result/system message 投影为语义 action |
| [`history-projector.ts`](history-projector.ts) | `SessionMessage` | 把公开 Session history 投影为最终 `ConversationItem` |
| [`product-user-message.ts`](product-user-message.ts) | SDK 用户/控制消息形状 | 把控制回执排除在产品用户文本之外 |

### Approval、问题与 MCP elicitation

| 文件 | SDK 公共符号 | 本层职责 |
| --- | --- | --- |
| [`interaction-broker.ts`](interaction-broker.ts) | `CanUseTool`、`OnElicitation`、`ElicitationResult`、`PermissionResult`、`PermissionUpdate` | 保留 callback Promise/abort 合同，并用应用 interaction id 关联浏览器响应 |
| [`ask-user.ts`](ask-user.ts) | `AskUserQuestion` 的 Tool input/permission shape | 校验和投影结构化问题/答案 |

### MCP 与 Hooks

| 文件 | SDK 公共符号/方法 | 本层职责 |
| --- | --- | --- |
| [`demo-mcp-server.ts`](demo-mcp-server.ts) | `createSdkMcpServer`、`tool`、`CallToolResult` | 构建只读 `showcase_project` 进程内 MCP Server |
| [`mcp-config.ts`](mcp-config.ts) | `McpServerConfig` 及 stdio/SSE/HTTP/tool policy 类型 | 从服务端文件读取并校验 MCP 配置 |
| [`mcp-service.ts`](mcp-service.ts) | `mcpServerStatus` 与 MCP OAuth/control 方法返回值 | 执行 Session-scoped MCP 控制，并将 status/metadata 脱敏、限量后投影 |
| [`hooks.ts`](hooks.ts) | `HookCallback`、`HookJSONOutput`、`Options["hooks"]` | 注册 callback 观测；只返回明确需要的 hook output |

Hook callback 记录与 SDK message stream 的 Hook lifecycle 是两个来源：前者使用 `source: "callback"` / `phase: "observation"`，后者使用 `source: "sdk-event"` 并保留 hook id。不要把它们当成重复项删除。

### 运行时、Task 与 Checkpoint

| 文件 | 使用的 Query 方法 | 本层职责 |
| --- | --- | --- |
| [`runtime-capability-service.ts`](runtime-capability-service.ts) | Model、Permission、目录、Context、Account/Usage、Command/Agent/Plugin、Task 与生成标题相关方法 | 在 registry guard 下执行运行时控制并发布应用 event |
| [`checkpoint-service.ts`](checkpoint-service.ts) | `rewindFiles`、`rewind` | 绑定 dry-run preview、capability、revision 与过期；在 mutation fence 内单次执行 |
| [`session-registry.ts`](session-registry.ts) | 不直接扩展 SDK surface | 管理 live controller、exclusive/guard/mutation 排序与关闭 |

Task route/service/API Client 和 [`task-details.tsx`](../../client/features/tasks/task-details.tsx) 已适配 `backgroundTasks()` 和 `stopTask()`，但当前 React 产品没有把 Task 设为 details selection 的可达入口，因此用户看不到 Task 控件。维护文档和试用案例必须区分“adapter/组件已存在”和“用户可以从 UI 直接调用”。

### 浏览器安全投影

下列文件处理从 SDK trust boundary 到浏览器的值，不改变 SDK 行为：

| 文件 | 职责 |
| --- | --- |
| [`redact.ts`](redact.ts) | `redactForBrowser()`、`safeRawPayload()`：credential-shaped 字段脱敏及深度/节点/字节预算 |
| [`error-text-redact.ts`](error-text-redact.ts) | `boundedErrorText()`：自由格式 SDK 错误限长与凭据替换 |
| [`browser-projection.ts`](browser-projection.ts) | `safeDiagnosticRecord()` 等稳定 browser-safe 记录 |

不要把 SDK Query、callback、原始 Tool input、Hook payload、MCP secret/metadata 或未经处理的错误对象直接发送给浏览器。

## 修改检查单

- SDK import 是否仍只位于本目录？运行 `npm run check:boundary`。
- 新方法是否真的被 service/controller 调用，还是只为扩大 `QueryPort`？
- fake 是否只实现应用 port，而没有假装证明真实账号/模型行为？
- live message 与 restored history 的最终语义是否保持一致？
- Session close/fatal 后是否停止 input、interaction 与 Query 复用？
- 新浏览器值是否经过严格 view model、脱敏和大小预算？
- 有可达产品入口时，是否同时增加 command ownership、局部错误和确定性测试？

代表测试位于 [`test/unit/server/sdk/`](../../../test/unit/server/sdk/) 与 [`test/integration/`](../../../test/integration/)；浏览器组装 journey 位于 [`test/e2e/showcase.spec.ts`](../../../test/e2e/showcase.spec.ts)。
