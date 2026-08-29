# Web UI Showcase SDK Code Tour

This guide answers one question: **Which Qoder TypeScript Agent SDK interface powers each capability visible in the UI, and at which layer does that interface become product behavior?**

If you have not called the SDK yet, complete [SDK Quick Start](SDK_QUICK_START.md) first. Use the [package README](../README.md) for installation, authentication, startup, and real-versus-fixture selection, and use the [Product Trial Guide](PRODUCT_TRIAL_GUIDE.md) for manual procedures. This guide does not repeat them.

The project currently uses `@qoder-ai/qoder-agent-sdk` 1.0.21. The browser does not import the SDK. SDK Queries, callbacks, credentials, and SDK-specific types exist only in [`src/server/sdk/`](../src/server/sdk/).

## Understand the Four Categories First

Before reading about a capability, identify its category:

1. **SDK-required contract:** public interfaces such as `query()` options, asynchronous `Query` iteration, `SDKUserMessage`, session state, control receipts, callbacks, the session catalog, and rewind.
2. **Showcase policy:** which methods `QueryPort` exposes, Composer defaults, capability gates, error ownership, and Checkpoint freshness rules.
3. **Product infrastructure:** Workspace canonicalization, REST/WebSocket, command correlation, parent-child event ordering, journal replay, snapshot/history consistency, mutation fences, browser redaction, and file suggestions.
4. **Optional diagnostics:** SDK Console, Hooks, and Raw Events—which are closed by default—and the explicitly opt-in real-account smoke test.

Every flow below identifies its category. Do not describe the third or fourth category as product behavior automatically supplied by the SDK.

## How a Message Moves Through the System

```text
React Composer
  │ 1. browser-safe command
  ▼
Fastify route ── Zod validation
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

Follow an ordinary send in this order:

1. [`api-client.ts`](../src/client/transport/api-client.ts) sends an application command; the browser does not know the `Query` type.
2. [`session-routes.ts`](../src/server/api/session-routes.ts) validates one request and delegates one operation.
3. [`session-service.ts`](../src/server/services/session-service.ts) enforces session/Workspace policy and finds the protected live controller through [`session-registry.ts`](../src/server/sdk/session-registry.ts).
4. [`input-queue.ts`](../src/server/sdk/input-queue.ts) implements application input as an `AsyncIterable<SDKUserMessage>`; [`session-controller.ts`](../src/server/sdk/session-controller.ts) continuously consumes the same Query.
5. [`query-factory.ts`](../src/server/sdk/query-factory.ts) is the application's only `query()` construction point.
6. [`message-projector.ts`](../src/server/sdk/message-projector.ts) turns SDK messages into semantic actions, which the controller publishes to [`event-journal.ts`](../src/server/realtime/event-journal.ts).
7. [`snapshot-service.ts`](../src/server/services/snapshot-service.ts) and [`realtime-hub.ts`](../src/server/realtime/realtime-hub.ts) provide consistent snapshots/replay; [`app-reducer.ts`](../src/client/store/app-reducer.ts) reduces application events only.

This is the example's most reusable boundary: SDK changes stay concentrated in the adapter, while the product layer uses stable command, event, and view models.

## The Single Query Creation Point

[`createQueryFactory()`](../src/server/sdk/query-factory.ts) composes authentication, Workspace, session, and interaction collaborators:

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

The real implementation also conditionally passes `sessionId`, `resume`, and `forkSession` according to intent. This fragment explains the **composition**, but it depends on the Showcase's `InputQueue`, `InteractionBroker`, and configuration and cannot be copied out of the project by itself. A complete runnable example is in [SDK Quick Start](SDK_QUICK_START.md#single-query).

### Why Use a Narrow `QueryPort`

[`query-port.ts`](../src/server/sdk/query-port.ts) declares only the `Query` methods consumed by this product. [`adaptQuery()`](../src/server/sdk/query-port.ts) is where a real Query enters the application. It is neither a complete SDK capability catalog nor a method-by-method wrapper:

- Production adapts a real `Query` into `QueryPort`.
- Services and controllers depend only on this application port and do not import the SDK.
- Tests inject a fake port to verify the application lifecycle without calling a real account.
- A method without a product entry point, service policy, and assembly test is not added to the port merely for completeness.

Use the exported types and official reference for `@qoder-ai/qoder-agent-sdk` as the authority for public SDK capabilities. Do not discover them by adding unused methods to `QueryPort`.

## Capability Map

| Learning goal | Public SDK symbol or method | Main adapter code | Product entry point | Representative verification |
| --- | --- | --- | --- | --- |
| Create a Query | `query`, `Options`, `AuthOptions`, `qodercliAuth`, `accessTokenFromEnv` | [`query-factory.ts`](../src/server/sdk/query-factory.ts) | Session start | [`query-factory.test.ts`](../test/unit/server/sdk/query-factory.test.ts) |
| Asynchronous input and streaming output | `SDKUserMessage`, `SDKMessage`, `includePartialMessages` | [`input-queue.ts`](../src/server/sdk/input-queue.ts), [`session-controller.ts`](../src/server/sdk/session-controller.ts), [`message-projector.ts`](../src/server/sdk/message-projector.ts) | Composer, conversation | [`input-queue.test.ts`](../test/unit/server/sdk/input-queue.test.ts), [`sessions.test.ts`](../test/integration/sessions.test.ts) |
| Session state, stop, and cancel | `session_state_changed`, `interrupt()`, `cancelAsyncMessage()` | [`session-controller.ts`](../src/server/sdk/session-controller.ts) | Stop, queued messages | [`session-controller.test.ts`](../test/unit/server/sdk/session-controller.test.ts) |
| Resume, fork, and manage sessions | `resume`, `forkSession`, `listSessions`, `getSessionInfo`, `getSessionMessages`, `renameSession`, `tagSession`, `deleteSession` | [`query-factory.ts`](../src/server/sdk/query-factory.ts), [`session-catalog.ts`](../src/server/sdk/session-catalog.ts) | Session sidebar and menus | [`session-catalog.test.ts`](../test/unit/server/sdk/session-catalog.test.ts), [`restart-hydration.test.ts`](../test/integration/restart-hydration.test.ts) |
| Approval and structured questions | `CanUseTool`, `PermissionResult`, `PermissionUpdate` | [`interaction-broker.ts`](../src/server/sdk/interaction-broker.ts), [`ask-user.ts`](../src/server/sdk/ask-user.ts) | Inline Approval and AskUserQuestion | [`interaction-broker.test.ts`](../test/unit/server/sdk/interaction-broker.test.ts), [`interactions.test.ts`](../test/integration/interactions.test.ts) |
| MCP elicitation | `OnElicitation`, `ElicitationResult` | [`interaction-broker.ts`](../src/server/sdk/interaction-broker.ts) | Inline MCP form | [`mcp-elicitation-schema.test.ts`](../test/unit/shared/mcp-elicitation-schema.test.ts), [`mcp.test.ts`](../test/integration/mcp.test.ts) |
| In-process MCP Tool | `createSdkMcpServer`, `tool`, `CallToolResult` | [`demo-mcp-server.ts`](../src/server/sdk/demo-mcp-server.ts) | `showcase_project` Tool | [`demo-mcp-server.test.ts`](../test/unit/server/sdk/demo-mcp-server.test.ts) |
| MCP status, configuration, and OAuth | `McpServerConfig`, `mcpServerStatus`, `mcpAuthenticate`, `mcpSubmitOAuthCallbackUrl` | [`mcp-config.ts`](../src/server/sdk/mcp-config.ts), [`mcp-service.ts`](../src/server/sdk/mcp-service.ts) | MCP tab in SDK Console | [`mcp-config.test.ts`](../test/unit/server/sdk/mcp-config.test.ts), [`mcp.test.ts`](../test/integration/mcp.test.ts) |
| Hook lifecycle | `HookCallback`, `HookJSONOutput`, `Options["hooks"]` | [`hooks.ts`](../src/server/sdk/hooks.ts), [`message-projector.ts`](../src/server/sdk/message-projector.ts) | Hooks/Raw Events in SDK Console | [`hooks.test.ts`](../test/unit/server/sdk/hooks.test.ts) |
| Model, Permission, and Context | `getAvailableModels`, `setModel`, `setPermissionMode`, `getContextUsage` | [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts) | Composer controls | [`runtime-capability-service.test.ts`](../test/unit/server/sdk/runtime-capability-service.test.ts), [`runtime-capabilities.test.ts`](../test/integration/runtime-capabilities.test.ts) |
| Task state and server-side controls | Task messages, `backgroundTasks`, `stopTask` | [`message-projector.ts`](../src/server/sdk/message-projector.ts), [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts), [`runtime-routes.ts`](../src/server/api/runtime-routes.ts) | **No reachable Task UI currently; events are observable in Raw Events in SDK Console** | [`session-controller.test.ts`](../test/unit/server/sdk/session-controller.test.ts), [`runtime-capabilities.test.ts`](../test/integration/runtime-capabilities.test.ts) |
| Checkpoint | `rewindFiles`, `rewind`, `RewindScope` | [`checkpoint-service.ts`](../src/server/sdk/checkpoint-service.ts), [`checkpoint-dialog.tsx`](../src/client/features/conversation/checkpoint-dialog.tsx) | Checkpoint dialog on a user message | [`checkpoints.test.ts`](../test/integration/checkpoints.test.ts), [`showcase.spec.ts`](../test/e2e/showcase.spec.ts) |
| Subagent history | `listSubagents`, `getSubagentMessages` | [`session-catalog.ts`](../src/server/sdk/session-catalog.ts), [`subagent-transcript-service.ts`](../src/server/services/subagent-transcript-service.ts) | Details for an `Agent` Tool | [`session-catalog.test.ts`](../test/unit/server/sdk/session-catalog.test.ts), [`showcase.spec.ts`](../test/e2e/showcase.spec.ts) |
| Account, Credits, and extension discovery | `accountInfo`, `getUsageInfo`, `supportedCommands`, `supportedAgents`, `listPlugins`, `reloadPlugins` | [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts), [`composer-command-catalog.ts`](../src/server/sdk/composer-command-catalog.ts) | SDK Console, Composer suggestions | [`runtime-capability-service.test.ts`](../test/unit/server/sdk/runtime-capability-service.test.ts) |
| Browser-safe projection | SDK messages/diagnostics reaching the wire boundary | [`redact.ts`](../src/server/sdk/redact.ts), [`error-text-redact.ts`](../src/server/sdk/error-text-redact.ts), [`browser-projection.ts`](../src/server/sdk/browser-projection.ts) | Errors, SDK Console | [`redact.test.ts`](../test/unit/server/sdk/redact.test.ts), [`message-projector.test.ts`](../test/unit/server/sdk/message-projector.test.ts) |

## Key Flows

### First Message and Parent-Child Session Events

This is **Showcase policy + product infrastructure**, not UI supplied by `query()`:

1. The home screen lets the user edit a draft before choosing a Workspace.
2. [`session-start-service.ts`](../src/server/services/session-start-service.ts) organizes native directory selection, canonical registration, session creation, and the first send as one operation.
3. The server canonicalizes the Workspace before it becomes the SDK `cwd`; the browser submits only a Workspace id.
4. After the Query is constructed and reserved in the registry, the application publishes the parent `session.upserted` event before calling `controller.start()` to produce lifecycle, input, or conversation child events.

Publishing the parent first is an application event-protocol requirement. It lets snapshot/realtime reducers safely ignore late events for unknown sessions. [`sessions.test.ts`](../test/integration/sessions.test.ts) covers concurrent deduplication, first-message preservation, deletion, and fatal Query replacement.

### Asynchronous Input and Session State

[`InputQueue`](../src/server/sdk/input-queue.ts) implements the **SDK-required `AsyncIterable<SDKUserMessage>` contract** and preserves `priority` and `shouldQuery`. The product Composer default of `next` / `true` is **Showcase policy**.

- `buffered`: still in the application's local queue.
- `delivered`: yielded to the SDK transport; does not mean that a turn completed.
- The SDK may combine inputs, and a result does not identify a unique source UUID. The controller therefore tracks submitted batches conservatively and does not clear every input after an arbitrary result.
- After `session_state_changed` is observed, `idle`, `running`, and `requires_action` are authoritative. Inferring idle from a result exists only for compatibility with older runtimes that do not send state.
- `interrupt()` coordinates using `still_queued` and optional `cancelled` UUIDs. A successful `cancelAsyncMessage(uuid)` removes only the corresponding input.

See [Long-Lived Interactive Query](SDK_QUICK_START.md#long-lived-interactive-query) for a copyable standalone example and field semantics.

### Semantic Projection and History Recovery

The SDK stream contains partial text, Tool lifecycle records, Tasks, Hooks, results, and control receipts. A product cannot render every frame as a separate card:

- [`projectSdkMessage()`](../src/server/sdk/message-projector.ts) turns live messages into semantic actions.
- [`history-projector.ts`](../src/server/sdk/history-projector.ts) recovers the same final user, Assistant, and Tool semantics from public SDK session history.
- Assistant text is split at Tool boundaries, and Tool input/status/result are merged by tool-use id.
- Records with `parent_tool_use_id` that belong to Subagent internals do not enter the main transcript. Only after the parent `Agent` Tool is selected does the server read that history through the public catalog API.

[`snapshot-service.ts`](../src/server/services/snapshot-service.ts) is **product infrastructure**. It coalesces concurrent history reads for the same session, buffers realtime mutations while loading, and uses generations so replacement/deletion invalidates stale reads. Checkpoint's `conversation.replaced` is authoritative. Live/history equivalence tests ignore transport UUIDs, timestamps, and temporary streaming state and compare only final semantics.

### Approval, AskUserQuestion, and MCP Elicitation

[`InteractionBroker`](../src/server/sdk/interaction-broker.ts) preserves the SDK callback Promise contract:

1. `canUseTool` or `onElicitation` receives an SDK request.
2. The broker stores the pending resolver and publishes a browser-safe interaction view.
3. After the user responds, the application resolves it by opaque interaction id; an SDK abort signal ends the wait.
4. Once a session closes, the application cannot respond to an expired request.

This adapter pattern is reusable. The specific inline cards, error text, and “allow once/deny” choices are product policy.

### Hook Sources and Browser Safety

[`createShowcaseHooks()`](../src/server/sdk/hooks.ts) produces callback observations with `source: "callback"` and `phase: "observation"`. Hook lifecycle records from the SDK message stream use `source: "sdk-event"` and retain the hook id. These are two valid evidence sources and must not be deduplicated only because they share an event name.

Before Hook input, Raw Events, permission-denied text, and MCP metadata enter the browser, credentials are redacted and limits are applied for bytes, depth, nodes, strings, and list counts. `redactForBrowser()`, `boundedErrorText()`, and `safeDiagnosticRecord()` are reusable utilities. The browser never receives SDK objects or remote MCP secrets.

### Task: An Adapter Does Not Imply a Product Control

SDK Task messages are projected into stable Task state. The server's [`runtime-routes.ts`](../src/server/api/runtime-routes.ts) and [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts), and the browser's [`api-client.ts`](../src/client/transport/api-client.ts), adapt `backgroundTasks()` / `stopTask()`.

**The current React product has no reachable Task list, background button, or stop button.** The source includes [`task-details.tsx`](../src/client/features/tasks/task-details.tsx) and API wiring, but the conversation does not expose a way to set a Task as `detailsSelection`; existing `openDetails()` calls are only for Approvals and Subagents. Asking the model in natural language to run or stop a Shell task in the background proves model behavior and the Task message stream only. It does not prove that the UI called these Query methods directly. Adding controls requires a discoverable entry point, command ownership, state feedback, and deterministic browser tests.

### Checkpoint: Safety Beyond SDK Rewind

The SDK provides `rewindFiles()`, `rewind()`, and `RewindScope`. The Showcase additionally enforces:

- Only a live, idle session with no pending interaction or mutation can be previewed.
- A dry run is bound to the session, target message, scope, capability, expiration time, and transcript revision.
- A preview can be consumed only once. Starting execution invalidates other previews for the same session.
- New input, session restart/deletion, or revision drift invalidates a preview.
- Rewind runs inside the mutation fence in [`session-registry.ts`](../src/server/sdk/session-registry.ts), blocking concurrent sends and history replacement.
- After conversation rewind, the application rereads SDK history and publishes one `conversation.replaced` event instead of making the browser guess which rows to delete.

This is **Showcase policy + product infrastructure**. It must not be described as product semantics automatically generated when `rewind()` is called.

### `@ Files` and Allowed Directories

`Query.addDirectories()` is an SDK call. `@ Files` is application infrastructure, not an SDK file-search API:

- The browser waits 200 ms and cancels requests superseded by new input.
- The `AbortSignal` reaches the file scan when the HTTP client disconnects.
- The server searches the canonical Workspace first, then allowed roots in stable order; every root shares one entry budget.
- Symlinks, generated directories, and real paths outside the roots are skipped. Only paths are returned; file contents are not read.

The corresponding code is in [`workspace-file-service.ts`](../src/server/services/workspace-file-service.ts) and [`prompt-composer.tsx`](../src/client/features/conversation/prompt-composer.tsx).

## Common Mistakes to Avoid

- Importing `@qoder-ai/qoder-agent-sdk` from React, API, or general-purpose services.
- Passing a browser path directly as SDK `cwd`, or allowing an existing session to switch Workspace silently.
- Creating a new Query for every user message instead of providing asynchronous input to one long-lived Query.
- Treating transport delivery as turn completion, or assuming every result corresponds to one input UUID.
- Rendering every SDK frame as one conversation row, which duplicates deltas, Tools, and recovered history.
- Returning SDK objects, Tool input, Hook payloads, MCP metadata, or raw errors directly to the browser.
- Resolving or rejecting an Approval or elicitation Promise after the session closes.
- Reusing an old Query after a fatal output or transport error.
- Publishing session-scoped child events before the parent session enters event state.
- Executing rewind from a stale Checkpoint preview, or replacing history during concurrent send/lifecycle operations.
- Treating deterministic fake tests as evidence that a real account, model, or remote MCP was verified.
- Describing a server/API adapter as an existing product control, especially for current Task controls.

## Extending This Example

When adding a browser-visible SDK capability:

1. Add the smallest adapter in [`src/server/sdk/`](../src/server/sdk/) or extend the existing `QueryPort`. Only methods the application actually consumes belong in the port.
2. Define the browser-safe command, event, snapshot, or view model in [`src/shared/`](../src/shared/).
3. Implement product policy, capability gates, concurrency, and error ownership in the route/service layer.
4. Reduce the event into normalized client state and expose it through a natural, discoverable product entry point.
5. Add adapter unit tests and assembled integration tests. Add an E2E journey only when browser behavior is the acceptance subject.
6. Update this capability map and the [Product Trial Guide](PRODUCT_TRIAL_GUIDE.md), stating evidence level and side effects explicitly.

After changing SDK imports, run `npm run check:boundary`. Before publishing, run the account-independent `npm run check`. See [`src/server/sdk/README.md`](../src/server/sdk/README.md) for directory-level maintenance rules.
