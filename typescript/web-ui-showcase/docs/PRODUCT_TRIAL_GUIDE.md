# Web UI Showcase 产品试用与 SDK 能力验收手册

本文面向产品、设计、测试和 SDK 集成开发者。它不是 API 参考，而是一组可在 Web UI 中执行的验收案例：每个案例都说明运行时、证据级别、确定性、副作用、操作、预期结果和失败判定。

本文按 `@qoder-ai/qoder-agent-sdk` 1.0.21 与当前 `web-ui-showcase` 编写。安装、认证、启动命令以及真实 SDK / fixture 的区别以[包根 README](../README.md#运行时选择)为准；SDK 源码映射见 [SDK 代码导览](SDK_CODE_TOUR.md#能力地图)。

## 先确认你在验证什么

本手册中的人工操作默认使用 `npm run dev` 或生产构建，因而会连接**真实 SDK 与当前认证**。自然语言 prompt 可能触发真实模型、Tool、文件或远程 MCP 调用。

`npm run check` 包含真实类型检查、生产构建和不创建 Session 的服务器 smoke，以及注入 fake/fixture 的确定性单元、集成和 Playwright 验收。Playwright fixture 不会逐字执行本手册 prompt；它证明真实浏览器、Fastify 路由、应用服务、Session controller、投影、journal 和恢复逻辑能够按受控事件组装。整个默认门禁不证明真实账号、模型、CLI 或远程 MCP 行为。

### 证据级别

| 级别 | 能证明什么 | 不能单独证明什么 |
| --- | --- | --- |
| **直接接口** | UI 操作沿应用 adapter 直接调用列出的 SDK 公共接口 | 模型一定采用某种策略或外部服务一定可用 |
| **消息流** | 可以从 `Query` 的异步 SDK message stream 观察到状态或事件 | 一定存在对应的独立 UI 控件 |
| **模型行为** | 自然语言促使模型选择 Tool、Subagent 或执行方式 | 应用直接调用了某个 Query 控制方法 |

### 确定性

- **高：** 直接 UI/API 操作为主，结果不依赖模型选择。
- **中：** 直接接口可验证，但触发时机、运行时 capability 或网络会造成差异。
- **低：** 主要依赖模型是否遵循 prompt 或选择指定 Tool。

“确定性低”不表示功能有问题；它表示验收时必须记录实际 SDK event/Tool，而不能只看 Assistant 的自然语言声明。

## 试用路线

| 时间 | 案例 | 目标 |
| --- | --- | --- |
| 5 分钟 | [CASE-01](#case-01-创建-session-并观察流式消息)、[CASE-11](#case-11-modelpermission-mode-与-context) | 跑通 Session/stream，并验证 Model、Permission、Context 控制不污染对话 |
| 15 分钟 | CASE-01、[CASE-02](#case-02-中断当前生成轮次)、[CASE-03](#case-03-允许一次-tool-approval)、[CASE-06](#case-06-调用内置-mcp-server)、[CASE-07](#case-07-观察-hooks-与-raw-events) | 覆盖创建、停止、Approval、MCP、Hook/Raw Event |
| 30 分钟 | 15 分钟组合，再加 [CASE-08](#case-08-启动并查看-subagent)、[CASE-14](#case-14-session-管理恢复与-fork)、[CASE-17](#case-17-预览并执行-checkpoint) | 增加 Subagent、Session 管理/恢复与 Checkpoint |

其余案例用于专项验收。模型或网络较慢时，实际时间可能延长。

## 通用准备与清理

1. 按[根 README](../README.md)启动真实应用，选择一个专门用于试用的本地目录作为 Workspace。
2. 不要选择包含凭证、隐私数据或未备份重要修改的目录。
3. Permission Mode 先使用 `default`，便于观察 Approval。
4. 写入案例只使用 `qoder-sdk-showcase-trial.txt` 和 `qoder-sdk-showcase-denied.txt`。
5. 长任务案例只使用 `sleep 300` 或 `sleep 20`；结束前确认进程已经停止。
6. SDK Console 的 Hooks/Raw Events 是诊断证据，不是普通产品界面。
7. 记录 Session 标题、案例、实际表现、SDK message/Tool、截图和清理结果。

## CASE-01 创建 Session 并观察流式消息

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 + 消息流 + 模型行为 ｜ **确定性：** 中 ｜ **副作用：** 创建持久 Session，发起真实模型 turn；prompt 只读

**前置条件**

- 停留在首页，不预先选择 Workspace；Composer 中没有需要保留的其他草稿。

**输入与步骤**

```text
请先用一句话说明你准备如何检查当前项目，然后再用三点总结这个项目的目录结构。此任务只读，不要修改文件。
```

1. 直接发送；系统要求时选择专用 Workspace。
2. 等 Assistant 完成，刷新页面并重新选择该 Session。

**预期结果**

- 首条草稿在目录选择后仍作为一条用户消息出现。
- 左侧创建一个绑定该 Workspace 的 Session。
- Assistant 增量更新同一语义消息，最终进入完成状态，没有重复 final。
- 刷新后 Session 与用户/Assistant 历史都能恢复。

**SDK 映射与证据**

- 直接：`query({ prompt, options })`、`Options.auth`、`cwd`、`sessionId`。
- 消息流：`includePartialMessages` 与 `AsyncIterable<SDKMessage>`。
- 恢复：`resume`、`getSessionMessages()`。

**失败判定与清理**

- 首条输入丢失、重复 Assistant、刷新后缺历史，均判失败。
- 可保留该 Session 继续后续案例；全部试用结束后从 Session 菜单删除记录。

## CASE-02 中断当前生成轮次

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 + 消息流 ｜ **确定性：** 中 ｜ **副作用：** 两次真实模型 turn，不修改文件

**前置条件**

- 使用一个已可用且 idle 的 Session。

**输入与步骤**

```text
请写一篇至少 3000 字的当前项目架构说明，先输出正文，不要调用工具。
```

1. Assistant 开始持续输出后，点击 Composer 的“停止”。
2. 再发送：

```text
请只回复 INTERRUPT_RECOVERED。
```

**预期结果**

- 原 Assistant 消息停止追加并显示中断状态。
- Session 没有关闭，Composer 恢复可输入；下一轮正常完成。
- 排队项依据 interrupt receipt 中的 `still_queued` / 可选 `cancelled` UUID 保留或取消。

**SDK 映射与证据**

- 直接：`Query.interrupt()`。
- 消息流：`session_state_changed` 的 `idle` / `running` / `requires_action`；result 推导 idle 只用于旧运行时兼容。

**失败判定与清理**

- 停止后仍持续追加、所有排队消息被无条件清空、或 Session 无法继续，均判失败。
- 无额外清理。

## CASE-03 允许一次 Tool Approval

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + 直接接口 + 消息流 ｜ **确定性：** 低 ｜ **副作用：** 尝试创建一个本地文件，发起真实 Tool 调用

**前置条件**

- Permission Mode 为 `default`；Workspace 可写且没有同名文件。

**输入与步骤**

```text
请使用文件写入工具在项目根目录创建 qoder-sdk-showcase-trial.txt，内容必须恰好是 APPROVAL_ALLOWED。不要使用 Bash；如果需要授权，请等待我在界面中确认。
```

1. 在 Approval 卡片打开详情，核对 Tool 名、路径和内容。
2. 点击“允许一次”，等待 Tool 完成；展开 Tool 行检查 Input/Result。

**预期结果**

- 未允许前写入不完成。
- 允许后 Tool 状态从等待/执行变为完成，文件内容恰好为 `APPROVAL_ALLOWED`。
- 同一 Approval 只响应一次。

**SDK 映射与证据**

- 模型先选择写入 Tool；随后 UI 通过 `Options.canUseTool` callback 直接返回 `{ behavior: "allow" }`。
- “始终允许”还会使用 SDK 提供的 `PermissionUpdate` 建议；本案例只验证一次允许。

**失败判定与清理**

- 未批准就写入、路径与卡片不一致、或批准后卡片仍 pending，均判失败。
- 验证后删除 `qoder-sdk-showcase-trial.txt`；如要继续 Checkpoint 案例，可先保留并在那里回退。

## CASE-04 拒绝 Tool Approval

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + 直接接口 + 消息流 ｜ **确定性：** 低 ｜ **副作用：** 尝试写入但预期不产生文件

**前置条件**

- Permission Mode 为 `default`；确认 `qoder-sdk-showcase-denied.txt` 不存在。

**输入与步骤**

```text
请使用文件写入工具创建 qoder-sdk-showcase-denied.txt，内容为 SHOULD_NOT_EXIST。不要使用 Bash。
```

1. 第一次出现 Approval 时，在拒绝原因中填写“产品试用：拒绝写入”。
2. 不勾选“同时停止当前轮次”，然后拒绝。
3. 再次发送同一段输入，等待新的 Approval；这次勾选“同时停止当前轮次”并拒绝，比较两次 turn 的表现。
4. 最后发送一个普通只读问题，确认 Session 可继续。

**预期结果**

- 文件没有创建；当前 turn 显示 permission-denied/无法完成，而不是全局连接错误。
- `interrupt: false` 与 `true` 的 turn 行为可区分；拒绝后 Session 仍可使用。

**SDK 映射与证据**

- `PermissionResult`：`behavior: "deny"`、`message`、`interrupt`。
- 用户填写的原因返回 Tool 流程；浏览器看到的是经过限长与脱敏的错误。

**失败判定与清理**

- 目标文件出现即判严重失败；同时记录 Tool、Permission Mode 和 Raw Event。
- 如果环境异常创建了文件，立即删除并停止该 Session 的写入试用。

## CASE-05 结构化 AskUserQuestion

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + 直接 callback ｜ **确定性：** 低 ｜ **副作用：** 一次真实模型 turn，不修改文件

**前置条件**

- Session idle；没有其他 pending Approval 或 elicitation。

**输入与步骤**

```text
在回答之前必须先使用 AskUserQuestion 工具问我一个单选问题：标题为“检查范围”，问题为“这次检查哪些内容？”，选项为“只看 README”和“查看整个项目”。收到答案后，只总结我选择的范围，不要修改文件。
```

1. 选择一个选项或填写自定义答案。
2. 点击“提交回答”，等待 Agent 继续。

**预期结果**

- 显示结构化“Agent 提问”卡片，而不是普通文本问题。
- 提交前 Agent 保持等待；提交后只继续一次，最终回复与选择一致。

**SDK 映射与证据**

- 模型是否选择 `AskUserQuestion` 属于模型行为。
- 触发后，Demo 在 `CanUseTool` 中识别输入，并通过 `PermissionResult.updatedInput` 直接提交答案。

**失败判定与清理**

- 无结构化卡片、重复提交、回答错配或 Session 永久停在 `requires_action`，均判失败。
- 无额外清理。

## CASE-06 调用内置 MCP Server

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + 消息流 ｜ **确定性：** 低 ｜ **副作用：** 真实模型与只读进程内 MCP Tool；不读取文件正文

**前置条件**

- SDK Console 的 MCP 页签显示 `showcase_project` 已连接。

**输入与步骤**

```text
请只使用 MCP Server showcase_project 提供的 list_project_entries 工具列出当前项目的顶层文件和目录。不要使用 Bash、Glob、Read 或其他文件工具；最后说明你调用的 MCP 工具名称。
```

1. 发送后检查对话中的 MCP Tool 行和展开结果。
2. 对照 Workspace 顶层名称与类型。

**预期结果**

- 模型调用 `mcp__showcase_project__list_project_entries` 对应 Tool，而不是其他文件工具。
- 结果只含顶层条目的名称/类型，不含文件正文；只读 `always_allow` Tool 通常不出现写入 Approval。

**SDK 映射与证据**

- `createSdkMcpServer()`、`tool()`、`Options.mcpServers`、`Query.mcpServerStatus()`。
- MCP 连接状态是直接读取；模型是否使用指定 Tool 仍是模型行为。

**失败判定与清理**

- MCP 页签未连接：记录为配置/运行时失败。已连接但模型不用 Tool：记录为模型引导问题，不能直接判定 MCP adapter 失败。
- 进程内只读 Tool 无额外清理。

## CASE-07 观察 Hooks 与 Raw Events

> **运行时：** 真实 SDK ｜ **证据：** 消息流 + callback 观测 ｜ **确定性：** 中 ｜ **副作用：** 只读取已投影诊断；依赖前一轮真实调用

**前置条件**

- 已完成 CASE-03 或 CASE-06 的一次 Tool 调用；SDK Console 可打开。

**输入与步骤**

1. 在 Hooks 查找 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse` 等记录。
2. 区分 `source: "callback"` / `phase: "observation"` 与 `source: "sdk-event"`；检查 hook id 关联。
3. 在 Raw Events 展开 Assistant、Tool、result 或 system message。
4. 检查 token、Authorization、cookie 等凭证字段和超大 MCP metadata 的投影。

**预期结果**

- callback 观察与 SDK lifecycle 是两个合法来源，不被错误合并。
- 主界面语义顺序可由 Raw Event 辅助解释。
- credential-shaped 值被脱敏，超大值受深度、节点、字节和数量限制。

**SDK 映射与证据**

- `Options.hooks`、`HookCallback`、`HookJSONOutput`、`includeHookEvents` 和 SDK message stream。
- 浏览器限量/脱敏属于 Showcase 基础设施，不是 SDK 自动生成的 UI。

**失败判定与清理**

- 明文凭证进入浏览器即判严重失败；缺少某个 Hook 时先核对运行时是否发出对应事件。
- 无额外清理。

## CASE-08 启动并查看 Subagent

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + 消息流 + 直接 catalog ｜ **确定性：** 低 ｜ **副作用：** 启动真实 Subagent；prompt 只读

**前置条件**

- 当前运行时支持 `Agent` Tool；Session idle。

**输入与步骤**

```text
必须使用 Agent 工具启动一个只读子代理，让它检查当前项目的 README 和 package.json，并返回三点摘要。主 Agent 不要自己调用 Read、Glob 或 Bash。
```

1. 等主对话出现 `Agent` Tool。
2. 点击该 Tool 打开 Subagent 详情，展开内部 Tool。

**预期结果**

- 子代理中间 Assistant/Tool 不混入主对话。
- 详情显示任务指令、Assistant 消息和内部 Tool，顺序正确；关闭详情不影响 Session。

**SDK 映射与证据**

- 实时 `parent_tool_use_id` 用于隔离主/子记录。
- 详情通过 `listSubagents(sessionId, options)` 与 `getSubagentMessages(sessionId, agentId, options)` 直接读取公开历史。

**失败判定与清理**

- 主对话重复子代理内部记录、详情关联到错误 Tool、或浏览器直接扫描 SDK transcript 文件，均判失败。
- 无本地文件清理；该 Subagent 记录随 Session 保留。

## CASE-09 后台 Shell Task 与前台对话

> **运行时：** 真实 SDK ｜ **证据：** 模型行为 + Task 消息流 ｜ **确定性：** 低 ｜ **副作用：** 启动最长 300 秒的本地 `sleep` 进程，必须清理

**前置条件**

- Workspace 允许使用 Bash；能够在试用后确认并停止进程。

**输入与步骤**

先发送：

```text
请使用 Bash 启动一个后台 Shell 任务，执行命令 sleep 300。确认任务已经启动后立即回复 BACKGROUND_STARTED，不要等待命令结束，也不要立即停止它。
```

收到回复后发送：

```text
不要等待或停止刚才的后台任务，只回复 FOREGROUND_CHAT_OK。
```

最后发送：

```text
请停止刚才启动的 sleep 300 后台任务，确认它不再运行，然后回复 BACKGROUND_STOPPED。
```

**预期结果**

- 第一轮不等待 300 秒；后台任务存在时第二轮仍可完成。
- Raw Events 可能出现 `task_started`、`task_updated`、`background_tasks_changed` 或 `task_notification`，组合由运行时决定。
- 最后一轮后没有遗留 `sleep 300` 进程。

**SDK 映射与证据**

- 本案例主要证明模型行为和 SDK Task message stream。
- 自然语言“后台运行”不等于 UI 调用了 `Query.backgroundTasks(toolUseId)`；“停止”也不等于 UI 调用了 `Query.stopTask(taskId)`。
- 服务端 route/service 和 API Client 已适配这两个方法，但**当前产品没有可达 Task 控件**。

**失败判定与清理**

- 前台被阻塞、Task 状态明显错配或进程未停止，均判失败。
- 必须独立确认并清理 `sleep 300`；不要只相信 Assistant 的“已停止”文本。

## CASE-10 运行中消息排队与取消

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 + 消息流 ｜ **确定性：** 低（时序敏感） ｜ **副作用：** 启动最长 20 秒的本地 `sleep`，产生真实模型 turn

**前置条件**

- Session idle；能够使用 Bash。

**输入与步骤**

先发送：

```text
请使用 Bash 在前台执行 sleep 20，命令结束后回复 LONG_TURN_DONE。
```

运行中立即发送：

```text
这是一条排队测试消息，只回复 QUEUED_MESSAGE_DONE。
```

在第二条尚未处理时点击“取消排队消息”。

**预期结果**

- Session 运行中仍可输入；第二条显示等待/处理中状态。
- 本地未交付时由应用队列取消；已 yield 给 SDK 后调用 `cancelAsyncMessage(uuid)`。
- SDK 已处理时，界面明确说明无法取消；队列状态不泄漏到其他 Session。

**SDK 映射与证据**

- `AsyncIterable<SDKUserMessage>`、`priority`、`shouldQuery`、`cancelAsyncMessage()`。
- `delivered` 仅代表 transport 交付。SDK 可合并输入，result 不标识唯一来源 UUID。

**失败判定与清理**

- 原消息被覆盖、取消后仍无解释地执行、或任意 result 清空全部输入，均判失败。
- 等 `sleep 20` 结束；如中断测试导致遗留，手动停止进程。

## CASE-11 Model、Permission Mode 与 Context

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 ｜ **确定性：** 高（取决于 runtime capability） ｜ **副作用：** 修改当前 Session 运行时设置；不自行发送模型消息

**前置条件**

- 当前 Session live；运行时能返回至少一个 Model。

**输入与步骤**

1. 在 Composer 输入 `/model`，选择建议并切换一个可用 Model。
2. 输入 `/permissions`，依次查看 `default`、`acceptEdits`、`auto`。
3. 输入 `/context`；再输入 `/context extra`。
4. 输入 `/mcp`。
5. 检查对话历史。

**预期结果**

- `/model`、`/permissions` 聚焦对应控件；设置完成后显示当前值。
- `/context` 更新 Context 指示，带参数时显示局部错误。
- `/mcp` 打开 SDK Console 的 MCP 页签。
- 这些产品控制命令不成为用户消息；失败归属对应控件而非全局 banner。

**SDK 映射与证据**

- `getAvailableModels({ fetchStrategy: "live" })`、`setModel()`、`setPermissionMode()`、`getContextUsage()`、`mcpServerStatus()`。

**失败判定与清理**

- 设置污染其他 Session、控制命令进入转录、或局部失败变成全局断线，均判失败。
- 结束时把 Permission Mode 恢复为后续案例需要的值。

## CASE-12 Commands、Skills 与 Prompt Suggestions

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 + 消息流 ｜ **确定性：** 中 ｜ **副作用：** 选择 Skill 可能发起真实输入；点击 Suggestion 本身不应发送

**前置条件**

- Session 初始化完成；如要观察动态 Prompt Suggestion，先完成一个模型 turn。

**输入与步骤**

1. 在空 Composer 输入 `/` 并使用键盘浏览建议。
2. 检查固定产品命令 `/context`、`/model`、`/mcp`、`/permissions`。
3. 对照 SDK Console 的 Skills；检查 runtime 支持时出现的 `compact` / `compress` / `summarize`。
4. 完成一轮后点击一个 Prompt Suggestion，但暂不发送。

**预期结果**

- 只有有执行策略的 SDK Command/Skill 被宣传。
- Suggestion 的选择、填充与发送是三个动作；点击只填草稿。
- 键盘 active option 始终可见。

**SDK 映射与证据**

- `promptSuggestions: true`、`initializationResult()`、`supportedCommands()` 与 `prompt_suggestion` SDK message。

**失败判定与清理**

- 展示无法执行的命令、点击 Suggestion 自动发起模型、或 Suggestions 被拼成一条，均判失败。
- 清空草稿；无其他清理。

## CASE-13 附加目录与 `@ Files`

> **运行时：** 真实 SDK + Showcase 本地基础设施 ｜ **证据：** 直接接口 ｜ **确定性：** 高 ｜ **副作用：** 扩大当前 Query 允许目录；本地扫描只返回路径

**前置条件**

- 准备一个不含敏感文件的专用附加目录。

**输入与步骤**

1. 在 Settings 点击“添加目录”，通过原生选择器选择专用目录。
2. 回到 Composer，输入 `@` 和部分文件名，选择一个建议但不发送。
3. 快速改变搜索文本，观察过时结果不会覆盖新结果。

**预期结果**

- SDK 接受的目录出现在允许列表。
- 建议可来自 Workspace 或附加目录，只插入路径，不读取正文或调用模型。
- 搜索不越界；过时请求被 debounce/abort。

**SDK 映射与证据**

- 直接 SDK 接口：`Query.addDirectories(directories)`。
- 原生选择、规范化、200 ms debounce、取消、Workspace 优先、跨 root 共用预算和 `@ Files` UI 都由 Showcase 实现，不是 SDK 文件搜索。

**失败判定与清理**

- 返回目录外路径、泄露正文、symlink 越界或旧结果覆盖新查询，均判严重失败。
- 可保留允许目录到 Session 结束；不再使用时删除该专用 Session。

## CASE-14 Session 管理、恢复与 Fork

> **运行时：** 真实 SDK ｜ **证据：** 直接 catalog + Query resume ｜ **确定性：** 高 ｜ **副作用：** 修改 Session 元数据，创建 Fork，最后可删除 Session 记录

**前置条件**

- 使用专用试用 Session，并已完成至少一个 turn。

**输入与步骤**

1. 打开 Session 行的 `…`，手动重命名；再试用“使用 SDK 生成标题”。
2. 添加标签，执行 `Fork`，确认原 Session 保留。
3. 刷新，分别选择原 Session 与 Fork。
4. 对一个专用 Session 执行“删除记录”。

**预期结果**

- 操作只作用于所选 Session；生成标题完成后持久化。
- Fork 有独立 id/history，不修改原历史。
- 刷新后两者可恢复；删除 Session 记录不会删除 Workspace 文件。

**SDK 映射与证据**

- `listSessions()`、`getSessionInfo()`、`getSessionMessages()`、`renameSession()`、`tagSession()`、`forkSession()`、`deleteSession()`。
- `generateSessionTitle(description, { persist: true })`；恢复 Query 使用 `Options.resume`。

**失败判定与清理**

- 菜单作用于相邻行、Fork 覆盖原记录、删除文件系统内容或恢复丢失首条消息，均判失败。
- 删除不再需要的原/Fork 试用记录；Workspace 目录需单独管理。

## CASE-15 Account、Agents 与 Plugins

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 ｜ **确定性：** 高/中（依赖账号与 runtime） ｜ **副作用：** 读取账号/用量，Plugin reload 会刷新运行时扩展

**前置条件**

- Session live；当前账号允许相关 capability。

**输入与步骤**

1. 在 SDK Console 查看 Agents。
2. 在 Plugins 点击“重新加载 Plugins”。
3. 在 Account 查看账号、Credits/Usage 和 SDK/CLI 版本。

**预期结果**

- 页签切换不向模型发送消息。
- reload 后重新读取 Plugin；不可用能力显示局部错误。
- 浏览器只收到展示所需的脱敏账号字段。

**SDK 映射与证据**

- `supportedAgents()`、`listPlugins()`、`reloadPlugins()`、`accountInfo()`、`getUsageInfo()`、`initializationResult()`。

**失败判定与清理**

- secret/token 出现在浏览器、能力失败导致 Session 崩溃、或页签操作污染转录，均判失败。
- 无本地清理；记录 Plugin reload 是否有环境副作用。

## CASE-16 远程 MCP、OAuth 与 elicitation

> **运行时：** 真实 SDK + 自备可信远程 MCP ｜ **证据：** 直接接口 + 消息流 + 可能的模型行为 ｜ **确定性：** 低 ｜ **副作用：** 网络、OAuth/remote server 状态；可能调用远程 Tool

**前置条件**

- 通过 `QODER_WEBUI_MCP_CONFIG_FILE` 配置专用、可信、可清理的测试 MCP Server。
- 内置 `showcase_project` 不需要 OAuth，也不会主动 elicitation，不能完成本案例。

**输入与步骤**

1. 在 MCP 页签观察连接、认证或失败状态。
2. 如需 OAuth，打开授权地址并提交 callback URL。
3. 触发测试 Server 的 form 或 URL elicitation，分别试用接受/拒绝/取消。
4. 使用“重连”并检查只影响当前 Session Query。

**预期结果**

- OAuth 静默成功时不显示多余动作；需要用户操作时才给出 URL/callback 流程。
- elicitation 使用专用对话卡片，resolve 后不重复提交。
- 浏览器只接收经过协议校验的授权 URL 和脱敏、限量的 MCP 状态；远程 headers、子进程环境和 OAuth token 不进入浏览器。
- 用户粘贴的 callback URL 只存在于组件本地输入和一次受校验的提交请求中；成功后输入被清除，callback URL 不进入 snapshot、realtime event 或诊断记录。

**SDK 映射与证据**

- `mcpServerStatus()`、`mcpAuthenticate()`、`mcpSubmitOAuthCallbackUrl()`、`Options.onElicitation`、`ElicitationResult`。

**失败判定与清理**

- 加载不可信配置、凭证投影到浏览器、重连错误 Session 或 callback 未校验，均判严重失败。
- 撤销测试 OAuth 授权、停止测试 MCP Server、移除临时配置和 token。

## CASE-17 预览并执行 Checkpoint

> **运行时：** 真实 SDK ｜ **证据：** 直接接口 ｜ **确定性：** 中/高（依赖 rewind capability） ｜ **副作用：** 可能回退 Workspace 文件和/或对话历史；只在专用目录执行

**前置条件**

- 使用专用 Workspace，重要修改已备份。
- Session live 且 idle；所有 Approval、AskUserQuestion、MCP elicitation 已处理。
- conversation/both 只有在初始化 capability 支持完整 Session rewind 时可选；否则只试 files。

**输入与步骤**

1. 完成一个包含后续 Assistant 或 Tool 记录的 turn；如验证文件回退，先在 CASE-03 创建专用文件。
2. 在目标用户消息点击 `Checkpoint`。
3. 用 Tab/Shift+Tab 检查 focus trap；Escape 关闭并返回触发按钮，然后重新打开。
4. 选择 files、conversation 或 both，点击“预览影响”。
5. 检查文件、insertions、deletions、失败项/拒绝原因；确认此时尚未真正回退。
6. 点击“执行 Checkpoint”。
7. 尝试重用旧 preview；再新建 preview、发送新消息后尝试执行；旧 preview 都应失效。
8. 在窄屏检查无页面横向滚动，关闭后焦点仍可继续操作原消息。

**预期结果**

- 未 dry-run 不能执行；preview 与 scope/capability 一致。
- 成功后显示 `success`，部分文件失败时显示 `partial` 与失败路径。
- conversation scope 保留目标用户消息，后续记录按 SDK 持久历史重新加载。
- busy、过期、revision 变化和重复消费在对话框内显示，不重复产生全局 command failure。
- realtime 与按 Session 请求的 snapshot 最终语义一致。

**SDK 映射与证据**

- files：`rewindFiles(userMessageId, { dryRun })`。
- conversation/both：`rewind(userMessageId, { scope, dryRun })` 与 `RewindScope`。
- idle 门禁、revision 绑定、单次 preview、sibling invalidation、mutation fence 和 `conversation.replaced` 都是 Showcase 安全策略，不是 SDK rewind 自动提供的 UI。

**失败判定与清理**

- 未预览即可执行、旧 preview 重用、并发 send 与 rewind 交错、或本地删行而未重读历史，均判失败。
- 核对文件和转录；清理专用文件与 Session。无法确定回退影响时停止使用该 Workspace 并从备份恢复。

## 当前不能作为 UI 直接调用证据的能力

### Task 控制

服务端 [`runtime-routes.ts`](../src/server/api/runtime-routes.ts)、[`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts) 和浏览器 [`api-client.ts`](../src/client/transport/api-client.ts) 已适配：

- `Query.backgroundTasks(toolUseId?)`
- `Query.stopTask(taskId)`

当前 React 产品没有可达 Task 列表或控制入口。因此 CASE-09 只能证明模型行为和 Task 消息流，不能声称用户从 UI 直接调用了这两个方法。

### 未暴露的其他 Query 方法

[`query-port.ts`](../src/server/sdk/query-port.ts) 有意只声明产品/service 实际调用的 SDK `Query` 子集。未进入 port 的能力应从 SDK 公共参考和专项 sample 学习；即使方法存在于 port 中，也只有具备可达 UI、产品策略、错误归属和确定性测试后，才能写成产品功能。

## 产品反馈记录模板

| 字段 | 示例 |
| --- | --- |
| 案例 | CASE-06 MCP Tool |
| 运行时 | 真实 SDK / fixture |
| 结果 | 通过 / 部分通过 / 失败 / 环境不支持 |
| 证据级别 | 直接接口 / 消息流 / 模型行为 |
| 实际表现 | MCP 已连接，模型第二次才选择指定 Tool |
| 确定性差异 | prompt 未被首次遵循，但连接和 Tool event 正常 |
| 副作用与清理 | 只读；无额外清理 |
| 是否容易发现 | 容易 / 一般 / 困难 |
| 状态是否清楚 | 清楚 / 缺少等待提示 / 错误位置不合理 |
| 证据附件 | 截图、Raw Event 类型、Session 标题 |
| 期望改进 | Tool 行显示 MCP Server 名称 |

集中讨论时重点回答：

1. 哪些 SDK 能力应留在普通产品界面，哪些只适合 SDK Console？
2. Tool、Approval、Subagent、MCP 与 Task 的状态能否区分？
3. 错误是否出现在拥有它的 turn/control，并给出下一步？
4. 哪些能力只能靠 prompt 发现，是否需要显式入口？
5. UI 表现能否快速定位到 [SDK 能力地图](SDK_CODE_TOUR.md#能力地图)中的 adapter？
6. 哪些本地应用基础设施容易被误认为 SDK 自带能力？

## 开发者验证边界

人工试用不能替代确定性回归；fixture 回归也不能替代真实账号验证。默认发布前运行 `npm run check`，真实 smoke 只在明确要发起外部 SDK 调用时运行。完整命令、超时与清理语义见[根 README 的验证章节](../README.md#验证)。
