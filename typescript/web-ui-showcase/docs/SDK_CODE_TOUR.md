# Web UI Showcase SDK 代码导览

本文用于回答一个问题：**用户在界面中看到的能力，究竟通过哪个 Qoder TypeScript Agent SDK 接口接入，又在哪一层变成了产品行为？**

如果尚未调用过 SDK，请先完成 [SDK 快速开始](SDK_QUICK_START.md)。安装、认证、启动和真实/fixture 选择以[包根 README](../README.md)为准；人工操作步骤以[产品试用手册](PRODUCT_TRIAL_GUIDE.md)为准。本文不重复它们。

本项目当前使用 `@qoder-ai/qoder-agent-sdk` 1.0.21。浏览器不 import SDK；SDK Query、回调、凭据和 SDK 专属类型只存在于 [`src/server/sdk/`](../src/server/sdk/)。

## 先理解四种性质

阅读任一能力时，先判断它属于哪一层：

1. **SDK 必需合同**：`query()` options、`Query` 异步迭代、`SDKUserMessage`、Session state、控制回执、回调、Session catalog 和 rewind 等公共接口。
2. **Showcase 策略**：`QueryPort` 暴露哪些方法、Composer 默认值、能力门禁、错误归属和 Checkpoint 新鲜度规则。
3. **产品基础设施**：Workspace 规范化、REST/WebSocket、command 关联、父子事件顺序、journal replay、snapshot/history 一致性、mutation fence、浏览器脱敏和文件建议。
4. **可选诊断**：默认关闭的 SDK Console、Hooks、Raw Events，以及显式 opt-in 的真实账号 smoke。

后面每个流程都会指出其性质。不要把第三、四层误写成 SDK 自动提供的产品能力。

## 一条消息如何穿过系统

```text
React Composer
  │ 1. browser-safe command
  ▼
Fastify route ── Zod 校验
  │ 2. application operation
  ▼
SessionService / RuntimeCapabilityService
  │ 3. policy + registry coordination
  ▼
SessionController ── QueryPort
  │ 4. SDKUserMessage / Query methods
  ▼
query() / Qoder TypeScript SDK
  │ 5. AsyncIterable<SDKMessage>
  ▼
message-projector ── EventJournal ── snapshot + realtime events
  │ 6. browser-safe semantic state
  ▼
AppStore / React product surface
```

按这个顺序阅读一次普通发送：

1. [`api-client.ts`](../src/client/transport/api-client.ts) 发送应用命令；浏览器不知道 `Query` 类型。
2. [`session-routes.ts`](../src/server/api/session-routes.ts) 校验一次请求并委派一次操作。
3. [`session-service.ts`](../src/server/services/session-service.ts) 处理 Session/Workspace 策略，并通过 [`session-registry.ts`](../src/server/sdk/session-registry.ts) 找到受保护的 live controller。
4. [`input-queue.ts`](../src/server/sdk/input-queue.ts) 把应用输入实现为 `AsyncIterable<SDKUserMessage>`；[`session-controller.ts`](../src/server/sdk/session-controller.ts) 持续消费同一个 Query。
5. [`query-factory.ts`](../src/server/sdk/query-factory.ts) 是整个应用唯一的 `query()` 构造点。
6. [`message-projector.ts`](../src/server/sdk/message-projector.ts) 把 SDK message 变成语义 action；controller 将其发布到 [`event-journal.ts`](../src/server/realtime/event-journal.ts)。
7. [`snapshot-service.ts`](../src/server/services/snapshot-service.ts) 和 [`realtime-hub.ts`](../src/server/realtime/realtime-hub.ts) 提供一致的 snapshot/replay；[`app-reducer.ts`](../src/client/store/app-reducer.ts) 只规约应用 event。

这是本样板最值得复用的边界：SDK 变化集中在 adapter，产品层使用稳定的 command/event/view model。

## 唯一 Query 创建点

[`createQueryFactory()`](../src/server/sdk/query-factory.ts) 集中组合认证、Workspace、Session 和交互协作者：

```ts
const sdkQuery = queryFn({
  prompt: input.input,
  options: {
    auth,
    cwd: input.workspacePath,
    model: input.model ?? config.model,
    permissionMode: input.permissionMode ?? config.permissionMode,
    enableFileCheckpointing: config.enableCheckpoints,
    includePartialMessages: true,
    includeHookEvents: true,
    promptSuggestions: true,
    canUseTool: input.interactions.canUseTool(input.getSessionId),
    onElicitation: input.interactions.onElicitation(input.getSessionId),
    mcpServers: input.mcpServers,
    hooks: input.hooks,
  },
});
```

真实实现还根据意图条件性传入 `sessionId`、`resume` 和 `forkSession`。这段代码用于解释**组合关系**，依赖 Showcase 的 `InputQueue`、`InteractionBroker` 和配置，不能脱离项目直接复制；完整可运行示例在 [SDK 快速开始](SDK_QUICK_START.md#单次-query)。

### 为什么使用窄 `QueryPort`

[`query-port.ts`](../src/server/sdk/query-port.ts) 只声明当前产品真实消费的 `Query` 方法；[`adaptQuery()`](../src/server/sdk/query-port.ts) 是真实 Query 进入应用的接缝。它不是完整 SDK 能力目录，也不逐方法重新包装：

- 生产环境把真实 `Query` 适配成 `QueryPort`。
- service/controller 只依赖这个应用 port，不 import SDK。
- 测试注入 fake port，验证应用生命周期而不调用真实账号。
- 没有产品入口、服务策略和组装测试的方法不会仅为“展示完整”而进入 port。

公开 SDK 能力应以 `@qoder-ai/qoder-agent-sdk` 包导出的类型和官方参考为准，而不是通过向 `QueryPort` 添加死方法来发现。

## 能力地图

| 学习目标 | SDK 公共符号或方法 | 主要适配代码 | 产品入口 | 代表验证 |
| --- | --- | --- | --- | --- |
| 创建 Query | `query`、`Options`、`AuthOptions`、`qodercliAuth`、`accessTokenFromEnv` | [`query-factory.ts`](../src/server/sdk/query-factory.ts) | Session 启动 | [`query-factory.test.ts`](../test/unit/server/sdk/query-factory.test.ts) |
| 异步输入与流式输出 | `SDKUserMessage`、`SDKMessage`、`includePartialMessages` | [`input-queue.ts`](../src/server/sdk/input-queue.ts)、[`session-controller.ts`](../src/server/sdk/session-controller.ts)、[`message-projector.ts`](../src/server/sdk/message-projector.ts) | Composer、对话区 | [`input-queue.test.ts`](../test/unit/server/sdk/input-queue.test.ts)、[`sessions.test.ts`](../test/integration/sessions.test.ts) |
| Session state、停止和取消 | `session_state_changed`、`interrupt()`、`cancelAsyncMessage()` | [`session-controller.ts`](../src/server/sdk/session-controller.ts) | 停止、排队消息 | [`session-controller.test.ts`](../test/unit/server/sdk/session-controller.test.ts) |
| 恢复、Fork 和管理 Session | `resume`、`forkSession`、`listSessions`、`getSessionInfo`、`getSessionMessages`、`renameSession`、`tagSession`、`deleteSession` | [`query-factory.ts`](../src/server/sdk/query-factory.ts)、[`session-catalog.ts`](../src/server/sdk/session-catalog.ts) | Session 侧栏与菜单 | [`session-catalog.test.ts`](../test/unit/server/sdk/session-catalog.test.ts)、[`restart-hydration.test.ts`](../test/integration/restart-hydration.test.ts) |
| Approval 与结构化问题 | `CanUseTool`、`PermissionResult`、`PermissionUpdate` | [`interaction-broker.ts`](../src/server/sdk/interaction-broker.ts)、[`ask-user.ts`](../src/server/sdk/ask-user.ts) | 对话内 Approval、AskUserQuestion | [`interaction-broker.test.ts`](../test/unit/server/sdk/interaction-broker.test.ts)、[`interactions.test.ts`](../test/integration/interactions.test.ts) |
| MCP elicitation | `OnElicitation`、`ElicitationResult` | [`interaction-broker.ts`](../src/server/sdk/interaction-broker.ts) | 对话内 MCP 表单 | [`mcp-elicitation-schema.test.ts`](../test/unit/shared/mcp-elicitation-schema.test.ts)、[`mcp.test.ts`](../test/integration/mcp.test.ts) |
| 进程内 MCP Tool | `createSdkMcpServer`、`tool`、`CallToolResult` | [`demo-mcp-server.ts`](../src/server/sdk/demo-mcp-server.ts) | `showcase_project` Tool | [`demo-mcp-server.test.ts`](../test/unit/server/sdk/demo-mcp-server.test.ts) |
| MCP 状态、配置与 OAuth | `McpServerConfig`、`mcpServerStatus`、`mcpAuthenticate`、`mcpSubmitOAuthCallbackUrl` | [`mcp-config.ts`](../src/server/sdk/mcp-config.ts)、[`mcp-service.ts`](../src/server/sdk/mcp-service.ts) | SDK Console 的 MCP 页签 | [`mcp-config.test.ts`](../test/unit/server/sdk/mcp-config.test.ts)、[`mcp.test.ts`](../test/integration/mcp.test.ts) |
| Hook 生命周期 | `HookCallback`、`HookJSONOutput`、`Options["hooks"]` | [`hooks.ts`](../src/server/sdk/hooks.ts)、[`message-projector.ts`](../src/server/sdk/message-projector.ts) | SDK Console 的 Hooks/Raw Events | [`hooks.test.ts`](../test/unit/server/sdk/hooks.test.ts) |
| Model、Permission 和 Context | `getAvailableModels`、`setModel`、`setPermissionMode`、`getContextUsage` | [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts) | Composer 控件 | [`runtime-capability-service.test.ts`](../test/unit/server/sdk/runtime-capability-service.test.ts)、[`runtime-capabilities.test.ts`](../test/integration/runtime-capabilities.test.ts) |
| Task 状态与服务端控制 | Task 消息、`backgroundTasks`、`stopTask` | [`message-projector.ts`](../src/server/sdk/message-projector.ts)、[`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts)、[`runtime-routes.ts`](../src/server/api/runtime-routes.ts) | **当前无可达 Task UI；SDK Console 的 Raw Events 可观察事件** | [`session-controller.test.ts`](../test/unit/server/sdk/session-controller.test.ts)、[`runtime-capabilities.test.ts`](../test/integration/runtime-capabilities.test.ts) |
| Checkpoint | `rewindFiles`、`rewind`、`RewindScope` | [`checkpoint-service.ts`](../src/server/sdk/checkpoint-service.ts)、[`checkpoint-dialog.tsx`](../src/client/features/conversation/checkpoint-dialog.tsx) | 用户消息的 Checkpoint 对话框 | [`checkpoints.test.ts`](../test/integration/checkpoints.test.ts)、[`showcase.spec.ts`](../test/e2e/showcase.spec.ts) |
| Subagent 历史 | `listSubagents`、`getSubagentMessages` | [`session-catalog.ts`](../src/server/sdk/session-catalog.ts)、[`subagent-transcript-service.ts`](../src/server/services/subagent-transcript-service.ts) | `Agent` Tool 的详情 | [`session-catalog.test.ts`](../test/unit/server/sdk/session-catalog.test.ts)、[`showcase.spec.ts`](../test/e2e/showcase.spec.ts) |
| Account、Credits 与扩展发现 | `accountInfo`、`getUsageInfo`、`supportedCommands`、`supportedAgents`、`listPlugins`、`reloadPlugins` | [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts)、[`composer-command-catalog.ts`](../src/server/sdk/composer-command-catalog.ts) | SDK Console、Composer 建议 | [`runtime-capability-service.test.ts`](../test/unit/server/sdk/runtime-capability-service.test.ts) |
| 浏览器安全投影 | 到达 wire 边界的 SDK message/诊断值 | [`redact.ts`](../src/server/sdk/redact.ts)、[`error-text-redact.ts`](../src/server/sdk/error-text-redact.ts)、[`browser-projection.ts`](../src/server/sdk/browser-projection.ts) | 错误、SDK Console | [`redact.test.ts`](../test/unit/server/sdk/redact.test.ts)、[`message-projector.test.ts`](../test/unit/server/sdk/message-projector.test.ts) |

## 重点流程

### 首条消息与 Session 父子事件

这是 **Showcase 策略 + 产品基础设施**，不是 `query()` 自带 UI：

1. 首页允许先编辑草稿，再选择 Workspace。
2. [`session-start-service.ts`](../src/server/services/session-start-service.ts) 把原生目录选择、规范化注册、Session 创建和首条发送组织成一个操作。
3. Workspace 变成 SDK `cwd` 前已由服务端规范化；浏览器只提交 Workspace id。
4. Query 已构造并在 registry 预留后，应用先发布父级 `session.upserted`，再调用 `controller.start()` 产生 lifecycle、input 或 conversation 子事件。

父级先于子事件是应用事件协议约束，使 snapshot/realtime reducer 可以安全忽略未知 Session 的迟到事件。并发去重、首条消息保留、删除和 fatal Query 替换由 [`sessions.test.ts`](../test/integration/sessions.test.ts) 覆盖。

### 异步输入与 Session state

[`InputQueue`](../src/server/sdk/input-queue.ts) 实现 **SDK 必需的 `AsyncIterable<SDKUserMessage>` 合同**，并保留 `priority` 和 `shouldQuery`。产品 Composer 默认 `next` / `true` 是 **Showcase 策略**。

- `buffered`：仍在应用本地队列。
- `delivered`：已经 yield 给 SDK transport，不代表 turn 完成。
- SDK 可以合并输入，result 不标识唯一来源 UUID；controller 因此保守跟踪已提交批次，不在任意 result 后清空所有输入。
- 观察到 `session_state_changed` 后，`idle`、`running`、`requires_action` 是权威状态；result 推导 idle 只兼容不发送 state 的旧运行时。
- `interrupt()` 依据 `still_queued` 和可选 `cancelled` UUID 协调；`cancelAsyncMessage(uuid)` 成功时只移除对应输入。

可复制的独立示例及字段语义见[长生命周期交互 Query](SDK_QUICK_START.md#长生命周期交互-query)。

### 语义投影与历史恢复

SDK 流包含部分文本、Tool 生命周期、Task、Hook、result 和控制回执。产品不能把每个 frame 渲染成一张卡片：

- [`projectSdkMessage()`](../src/server/sdk/message-projector.ts) 把 live message 变成语义 action。
- [`history-projector.ts`](../src/server/sdk/history-projector.ts) 从公开 SDK Session history 恢复同样的最终用户、Assistant 和 Tool 语义。
- Assistant 文本在 Tool 边界拆分，Tool 输入/状态/结果按 tool-use id 合并。
- `parent_tool_use_id` 标记的 Subagent 内部记录不会混入主转录；选择父 `Agent` Tool 后，服务端才通过公开 catalog API 读取对应历史。

[`snapshot-service.ts`](../src/server/services/snapshot-service.ts) 是 **产品基础设施**：它合并同一 Session 的并发历史读取，在加载期间缓冲 realtime mutation，并用 generation 让 replacement/deletion 使旧读取失效。Checkpoint 的 `conversation.replaced` 是权威替换。live/history 契约测试忽略 transport UUID、时间戳和临时 streaming 状态，只比较最终语义。

### Approval、AskUserQuestion 与 MCP elicitation

[`InteractionBroker`](../src/server/sdk/interaction-broker.ts) 保留 SDK callback 的 Promise 合同：

1. `canUseTool` 或 `onElicitation` 收到 SDK 请求。
2. Broker 保存 pending resolver，发布浏览器安全 interaction view。
3. 用户响应后，应用按不透明 interaction id resolve；SDK abort signal 则终止等待。
4. Session 关闭时不会继续响应已失效的请求。

这是可复用的 adapter 模式。具体对话卡片、错误文案和“允许一次/拒绝”是产品策略。

### Hook 来源与浏览器安全

[`createShowcaseHooks()`](../src/server/sdk/hooks.ts) 产生 callback 观测，记录 `source: "callback"`、`phase: "observation"`；SDK 消息流中的 Hook 生命周期记录使用 `source: "sdk-event"` 并保留 hook id。它们是两个合法证据来源，不能仅因 event 名相同而去重。

Hook input、Raw Event、permission-denied 文本和 MCP metadata 在进入浏览器前经过凭据脱敏，以及字节、深度、节点、字符串和列表数量限制。`redactForBrowser()`、`boundedErrorText()` 与 `safeDiagnosticRecord()` 是可复用工具；浏览器永远不接收 SDK 对象或远程 MCP secret。

### Task：适配存在，不代表产品控件存在

SDK Task message 会被投影为稳定 Task state。服务端 [`runtime-routes.ts`](../src/server/api/runtime-routes.ts)、[`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts) 和浏览器 [`api-client.ts`](../src/client/transport/api-client.ts) 已适配 `backgroundTasks()` / `stopTask()`。

**当前 React 产品没有可达的 Task 列表、后台化按钮或停止按钮。** 源码已有 [`task-details.tsx`](../src/client/features/tasks/task-details.tsx) 和 API wiring，但对话区没有把 Task 设为 `detailsSelection` 的入口；现有 `openDetails()` 调用只用于 Approval 和 Subagent。自然语言让模型后台运行或停止 Shell 任务，只能证明模型行为和 Task 消息流，不能证明 UI 直接调用上述 Query 方法。要新增控件，必须同时补齐可发现入口、command ownership、状态反馈和确定性浏览器测试。

### Checkpoint：SDK rewind 之外的安全边界

SDK 提供 `rewindFiles()`、`rewind()` 和 `RewindScope`；Showcase 另外实现：

- 只允许 live、idle、无 pending interaction/mutation 的 Session 预览。
- dry-run 绑定 Session、目标消息、scope、capability、过期时间和 transcript revision。
- 预览只能消费一次；执行开始后，同 Session 的其他预览失效。
- 新输入、Session 重启/删除或 revision 漂移会使预览失效。
- rewind 在 [`session-registry.ts`](../src/server/sdk/session-registry.ts) 的 mutation fence 内执行，阻止并发 send/history replacement。
- conversation rewind 完成后重读 SDK history 并发布一次 `conversation.replaced`，不让浏览器猜测应该删除哪些行。

这部分是 **Showcase 策略 + 产品基础设施**，不能描述成调用 `rewind()` 后 SDK 自动生成的产品语义。

### `@ Files` 与允许目录

`Query.addDirectories()` 是 SDK 调用；`@ Files` 是应用基础设施，不是 SDK 文件搜索 API：

- 浏览器等待 200 ms 并取消被新输入取代的请求。
- HTTP client 断开时，`AbortSignal` 传到文件扫描。
- 服务端先搜索规范化 Workspace，再按稳定顺序搜索 allowed roots；所有 root 共用一份 entry budget。
- 跳过 symlink、生成目录和越界 real path，只返回路径，不读取文件正文。

对应代码在 [`workspace-file-service.ts`](../src/server/services/workspace-file-service.ts) 与 [`prompt-composer.tsx`](../src/client/features/conversation/prompt-composer.tsx)。

## 应避免的常见错误

- 从 React、API 或通用 service import `@qoder-ai/qoder-agent-sdk`。
- 直接把浏览器路径作为 SDK `cwd`，或让现有 Session 静默切换 Workspace。
- 为每条用户消息创建新 Query，而不是给一个长生命周期 Query 提供异步输入。
- 把 transport delivery 当成 turn completion，或假设每个 result 对应唯一输入 UUID。
- 把每个 SDK frame 当作一行对话，导致 delta、Tool 和历史恢复重复。
- 把 SDK 对象、Tool input、Hook payload、MCP metadata 或原始错误直接返回浏览器。
- Session 关闭后仍 resolve/reject Approval 或 elicitation Promise。
- 在 fatal output/transport error 后继续复用旧 Query。
- 在父 Session 进入事件状态前发布 Session-scoped 子事件。
- 用过期 Checkpoint preview 执行 rewind，或在并发 send/lifecycle 操作期间替换历史。
- 把确定性 fake 测试当成真实账号、模型或远程 MCP 已验证的证据。
- 把服务端/API adapter 写成已有产品控件，尤其是当前 Task 控制。

## 扩展这个样板

新增一个浏览器可见 SDK 能力时：

1. 在 [`src/server/sdk/`](../src/server/sdk/) 添加最小 adapter 或扩展现有 `QueryPort`；只有应用真实消费的方法才进入 port。
2. 在 [`src/shared/`](../src/shared/) 定义浏览器安全 command、event、snapshot 或 view model。
3. 在 route/service 中实现产品策略、能力门禁、并发与错误归属。
4. 把 event 规约到标准化 client state，并放到自然、可发现的产品入口。
5. 增加 adapter 单测与组装集成测试；只有浏览器行为是验收主题时才增加 E2E journey。
6. 更新本页能力地图和[产品试用手册](PRODUCT_TRIAL_GUIDE.md)，明确证据级别与副作用。

修改 SDK import 后运行 `npm run check:boundary`；发布前运行不需要账号的 `npm run check`。更多目录级维护约束见 [`src/server/sdk/README.md`](../src/server/sdk/README.md)。
