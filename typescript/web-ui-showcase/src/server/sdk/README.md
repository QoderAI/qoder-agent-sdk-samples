# SDK Adapter Maintenance Guide

[`src/server/sdk/`](.) is the only directory in this example that may import `@qoder-ai/qoder-agent-sdk`. [`scripts/check-sdk-import-boundary.mjs`](../../../scripts/check-sdk-import-boundary.mjs) enforces the boundary. `api/`, `services/`, `shared/`, and `client/` depend only on application-owned ports, commands, events, and view models.

For complete examples aimed at first-time SDK users, see [SDK Quick Start](../../../docs/SDK_QUICK_START.md). For the end-to-end architecture, see [SDK Code Tour](../../../docs/SDK_CODE_TOUR.md). For installation and runtime selection, see the [package README](../../../README.md). This page is only a colocated index for adapter changes.

## Reading Order

1. [`query-factory.ts`](query-factory.ts): the application's only `query()` construction point; composes authentication, `cwd`, session intent, Model, Permission, Checkpoint, partial messages, Hooks, MCP, and interaction callbacks.
2. [`query-port.ts`](query-port.ts): the subset of public `Query` methods actually consumed by the product; `adaptQuery()` is where a real Query enters the application.
3. [`input-queue.ts`](input-queue.ts) and [`session-controller.ts`](session-controller.ts): input, output, session state, interrupt/cancel, and shutdown for one long-lived Query.
4. [`message-projector.ts`](message-projector.ts) and [`history-projector.ts`](history-projector.ts): live/history semantic projection.
5. Use the capability map below to find a specific adapter.

`QueryPort` is **not** a complete mirror or capability catalog for SDK Query. A method belongs in the interface only when a service/controller calls it and product policy and tests exist for it. The public contracts exported by the installed `@qoder-ai/qoder-agent-sdk` package and the official SDK reference remain authoritative.

## Capability Map

### Query, Authentication, and Session Intent

| File | Public SDK symbols | Responsibility in this layer |
| --- | --- | --- |
| [`query-factory.ts`](query-factory.ts) | `query`, `Options`, `AuthOptions`, `qodercliAuth`, `accessTokenFromEnv`, `SDKUserMessage` | Select authentication; pass `cwd`, `sessionId` / `resume` / `forkSession`, and runtime options |
| [`query-port.ts`](query-port.ts) | `Query`, `SDKMessage`, `PermissionMode`, `RewindScope` | Declare the smallest Query subset currently consumed by the application without reimplementing SDK behavior |
| [`sdk-public-contract.ts`](sdk-public-contract.ts) | `listSessions`, `getSessionInfo`, `getSessionMessages`, `getSubagentMessages`, `listSubagents`, `renameSession`, `tagSession`, `forkSession`, `deleteSession` | Collect public session functions into an injectable contract |
| [`session-catalog.ts`](session-catalog.ts) | `SDKSessionInfo`, `SessionMessage`, and the functions above | List, read, restore, rename, fork, and delete sessions, and read Subagent history |

### Long-Lived Query and Messages

| File | Public SDK symbol/method | Responsibility in this layer |
| --- | --- | --- |
| [`input-queue.ts`](input-queue.ts) | `SDKUserMessage` | Implement `AsyncIterable<SDKUserMessage>` while preserving `uuid`, `priority`, `shouldQuery`, and local cancellation state |
| [`session-controller.ts`](session-controller.ts) | Asynchronous `Query` iteration, `initializationResult`, `interrupt`, `cancelAsyncMessage`, `close` | Consume output; coordinate the lifecycle primarily from SDK session state; manage fatal failures and shutdown |
| [`message-projector.ts`](message-projector.ts) | `SDKMessage`, `SDKResultError` | Project live Assistant/Tool/Task/Hook/result/system messages into semantic actions |
| [`history-projector.ts`](history-projector.ts) | `SessionMessage` | Project public session history into final `ConversationItem` records |
| [`product-user-message.ts`](product-user-message.ts) | SDK user/control message forms | Exclude control acknowledgements from product user text |

### Approval, Questions, and MCP Elicitation

| File | Public SDK symbols | Responsibility in this layer |
| --- | --- | --- |
| [`interaction-broker.ts`](interaction-broker.ts) | `CanUseTool`, `OnElicitation`, `ElicitationResult`, `PermissionResult`, `PermissionUpdate` | Preserve callback Promise/abort behavior and correlate browser responses through application interaction ids |
| [`ask-user.ts`](ask-user.ts) | `AskUserQuestion` Tool input/permission form | Validate and project structured questions and answers |

### MCP and Hooks

| File | Public SDK symbol/method | Responsibility in this layer |
| --- | --- | --- |
| [`demo-mcp-server.ts`](demo-mcp-server.ts) | `createSdkMcpServer`, `tool`, `CallToolResult` | Build the read-only in-process `showcase_project` MCP server |
| [`mcp-config.ts`](mcp-config.ts) | `McpServerConfig` plus stdio/SSE/HTTP/tool-policy types | Read and validate MCP configuration from a server-side file |
| [`mcp-service.ts`](mcp-service.ts) | `mcpServerStatus` and MCP OAuth/control method results | Run session-scoped MCP controls and project status/metadata after redaction and bounding |
| [`hooks.ts`](hooks.ts) | `HookCallback`, `HookJSONOutput`, `Options["hooks"]` | Register callback observations and return only explicitly required Hook output |

Hook callback records and Hook lifecycle records from the SDK message stream are separate sources. The former use `source: "callback"` / `phase: "observation"`; the latter use `source: "sdk-event"` and retain the Hook id. Do not delete them as duplicates.

### Runtime, Task, and Checkpoint

| File | Query methods used | Responsibility in this layer |
| --- | --- | --- |
| [`runtime-capability-service.ts`](runtime-capability-service.ts) | Methods for Model, Permission, directories, Context, Account/Usage, Command/Agent/Plugin, Task, and title generation | Execute runtime controls under the registry guard and publish application events |
| [`checkpoint-service.ts`](checkpoint-service.ts) | `rewindFiles`, `rewind` | Bind dry-run previews to capability, revision, and expiration, then execute them once inside the mutation fence |
| [`session-registry.ts`](session-registry.ts) | Does not directly widen the SDK surface | Manage live controllers, exclusive/guard/mutation ordering, and shutdown |

Task routes/services, the API client, and [`task-details.tsx`](../../client/features/tasks/task-details.tsx) adapt `backgroundTasks()` and `stopTask()`, but the current React product has no reachable entry point that sets a Task as the details selection, so users cannot see Task controls. Maintenance documentation and trial cases must distinguish “the adapter/component exists” from “the user can call it directly from the UI.”

### Browser-Safe Projection

The following files handle values crossing from the SDK trust boundary to the browser without changing SDK behavior:

| File | Responsibility |
| --- | --- |
| [`redact.ts`](redact.ts) | `redactForBrowser()`, `safeRawPayload()`: redact credential-shaped fields and enforce depth/node/byte budgets |
| [`error-text-redact.ts`](error-text-redact.ts) | `boundedErrorText()`: bound free-form SDK errors and replace credentials |
| [`browser-projection.ts`](browser-projection.ts) | Stable browser-safe records such as `safeDiagnosticRecord()` |

Never send SDK Queries, callbacks, raw Tool input, Hook payloads, MCP secrets/metadata, or unprocessed error objects directly to the browser.

## Change Checklist

- Are SDK imports still confined to this directory? Run `npm run check:boundary`.
- Is a new method actually called by a service/controller, or does it only widen `QueryPort`?
- Does a fake implement only the application port without pretending to prove real account/model behavior?
- Do live messages and restored history retain equivalent final semantics?
- After session close/fatal failure, do input, interactions, and Query reuse stop?
- Does every new browser value pass through a strict view model, redaction, and size budgets?
- When a reachable product entry point is added, are command ownership, local errors, and deterministic tests added with it?

Representative tests are in [`test/unit/server/sdk/`](../../../test/unit/server/sdk/) and [`test/integration/`](../../../test/integration/). The assembled browser journey is in [`test/e2e/showcase.spec.ts`](../../../test/e2e/showcase.spec.ts).
