# Web UI Showcase Product Trial and SDK Capability Acceptance Guide

This guide is for product, design, test, and SDK integration teams. It is not an API reference. It is a set of acceptance cases that can be performed in the Web UI, with the runtime, evidence level, determinism, side effects, procedure, expected result, and failure criteria stated for every case.

The guide targets `@qoder-ai/qoder-agent-sdk` 1.0.21 and the current `web-ui-showcase`. Use [Runtime Selection in the package README](../README.md#runtime-selection) as the authority for installation, authentication, startup commands, and the distinction between the real SDK and fixtures. See the [SDK Code Tour capability map](SDK_CODE_TOUR.md#capability-map) for source-code mappings.

## Confirm What You Are Verifying

Manual procedures in this guide use `npm run dev` or the production build by default, so they connect to the **real SDK and current authentication**. A natural-language prompt may cause real model, Tool, file, or remote MCP calls.

`npm run check` includes real type checks, a production build, a server smoke test that creates no session, and deterministic unit, integration, and Playwright acceptance tests with injected fakes/fixtures. The Playwright fixture does not execute every prompt in this guide verbatim. It proves that the real browser, Fastify routes, application services, Session controller, projection, journal, and recovery logic assemble correctly around controlled events. The default gate does not prove real account, model, CLI, or remote MCP behavior.

### Evidence Levels

| Level | What it proves | What it cannot prove by itself |
| --- | --- | --- |
| **Direct interface** | A UI operation calls the listed public SDK interface through the application adapter | That the model will choose a particular strategy or an external service will be available |
| **Message stream** | State or events can be observed in the asynchronous SDK message stream from the `Query` | That a dedicated UI control exists for the capability |
| **Model behavior** | Natural language prompts the model to choose a Tool, Subagent, or execution strategy | That the application directly called a particular Query control method |

### Determinism

- **High:** Primarily a direct UI/API operation; the result does not depend on model choice.
- **Medium:** A direct interface can be verified, but timing, runtime capability, or network conditions may vary.
- **Low:** Primarily depends on whether the model follows the prompt or selects the requested Tool.

Low determinism does not indicate a defect. It means acceptance evidence must record the actual SDK event or Tool instead of relying only on an Assistant statement.

## Trial Routes

| Time | Cases | Goal |
| --- | --- | --- |
| 5 minutes | [CASE-01](#case-01-create-a-session-and-observe-streaming-messages), [CASE-11](#case-11-model-permission-mode-and-context) | Complete the Session/stream path and verify that Model, Permission, and Context controls do not pollute the conversation |
| 15 minutes | CASE-01, [CASE-02](#case-02-interrupt-the-current-generation), [CASE-03](#case-03-allow-a-tool-once), [CASE-06](#case-06-call-the-built-in-mcp-server), [CASE-07](#case-07-observe-hooks-and-raw-events) | Cover creation, stop, Approval, MCP, and Hook/Raw Event behavior |
| 30 minutes | The 15-minute route plus [CASE-08](#case-08-start-and-inspect-a-subagent), [CASE-14](#case-14-manage-resume-and-fork-sessions), [CASE-17](#case-17-preview-and-execute-a-checkpoint) | Add Subagent, session management/recovery, and Checkpoint coverage |

The remaining cases are for focused acceptance. Actual duration may increase when the model or network is slow.

## General Preparation and Cleanup

1. Start the real application using the [root README](../README.md), then choose a local directory dedicated to the trial as the Workspace.
2. Do not select a directory containing credentials, private data, or important unbacked-up changes.
3. Begin with Permission Mode set to `default` so Approvals are observable.
4. Write cases use only `qoder-sdk-showcase-trial.txt` and `qoder-sdk-showcase-denied.txt`.
5. Long-running cases use only `sleep 300` or `sleep 20`. Confirm that each process has stopped before finishing.
6. Hooks/Raw Events in SDK Console are diagnostic evidence, not the ordinary product UI.
7. Record the session title, case, actual behavior, SDK message/Tool, screenshots, and cleanup result.

## CASE-01 Create a Session and Observe Streaming Messages

> **Runtime:** Real SDK | **Evidence:** Direct interface + message stream + model behavior | **Determinism:** Medium | **Side effects:** Creates a persistent session and makes a real model turn; the prompt is read-only

**Prerequisites**

- Stay on the home screen without preselecting a Workspace. The Composer must not contain another draft that needs to be kept.

**Input and procedure**

```text
First explain in one sentence how you plan to inspect the current project. Then summarize the project's directory structure in three points. This task is read-only; do not modify files.
```

1. Send the prompt directly and choose the dedicated Workspace when requested.
2. Wait for the Assistant to finish, refresh the page, and select the session again.

**Expected result**

- The first draft still appears as one user message after directory selection.
- The sidebar contains a new session bound to that Workspace.
- Assistant deltas update one semantic message, which reaches completed state without a duplicate final message.
- The session and user/Assistant history are restored after refresh.

**SDK mapping and evidence**

- Direct: `query({ prompt, options })`, `Options.auth`, `cwd`, and `sessionId`.
- Message stream: `includePartialMessages` and `AsyncIterable<SDKMessage>`.
- Recovery: `resume` and `getSessionMessages()`.

**Failure criteria and cleanup**

- Loss of the first input, a duplicated Assistant message, or missing history after refresh is a failure.
- Keep the session for later cases if useful; delete its record from the session menu after all trials.

## CASE-02 Interrupt the Current Generation

> **Runtime:** Real SDK | **Evidence:** Direct interface + message stream | **Determinism:** Medium | **Side effects:** Two real model turns; no file changes

**Prerequisites**

- Use an available, idle session.

**Input and procedure**

```text
Write an architecture description of the current project that is at least 3,000 words. Start with the main text and do not call tools.
```

1. After the Assistant begins sustained output, click Stop (`停止`) in the Composer.
2. Send:

```text
Reply with INTERRUPT_RECOVERED only.
```

**Expected result**

- The original Assistant message stops growing and shows interrupted state.
- The session remains open, the Composer becomes usable again, and the next turn completes normally.
- Queued items are retained or cancelled according to `still_queued` and optional `cancelled` UUIDs in the interrupt receipt.

**SDK mapping and evidence**

- Direct: `Query.interrupt()`.
- Message stream: `idle`, `running`, and `requires_action` from `session_state_changed`. Inferring idle from a result exists only for older-runtime compatibility.

**Failure criteria and cleanup**

- Continued output after Stop, unconditional removal of every queued message, or an unusable session is a failure.
- No additional cleanup.

## CASE-03 Allow a Tool Once

> **Runtime:** Real SDK | **Evidence:** Model behavior + direct interface + message stream | **Determinism:** Low | **Side effects:** Attempts to create one local file and makes a real Tool call

**Prerequisites**

- Permission Mode is `default`; the Workspace is writable and the target file does not exist.

**Input and procedure**

```text
Use the file-writing tool to create qoder-sdk-showcase-trial.txt in the project root. Its content must be exactly APPROVAL_ALLOWED. Do not use Bash. If authorization is required, wait for me to confirm it in the UI.
```

1. Open details on the Approval card and verify the Tool name, path, and content.
2. Click Allow Once (`允许一次`), wait for the Tool to complete, and expand the Tool row to inspect Input/Result.

**Expected result**

- The write does not complete before approval.
- After approval, Tool state moves from waiting/running to completed, and the file content is exactly `APPROVAL_ALLOWED`.
- The same Approval can be answered only once.

**SDK mapping and evidence**

- The model first selects the writing Tool. The UI then directly returns `{ behavior: "allow" }` from the `Options.canUseTool` callback.
- Always Allow (`始终允许`) also uses SDK-provided `PermissionUpdate` suggestions; this case verifies one-time approval only.

**Failure criteria and cleanup**

- Writing before approval, a mismatch between the card and the path, or a card that remains pending after approval is a failure.
- Delete `qoder-sdk-showcase-trial.txt` after verification. It may be kept temporarily for the Checkpoint case and reverted there.

## CASE-04 Deny Tool Approval

> **Runtime:** Real SDK | **Evidence:** Model behavior + direct interface + message stream | **Determinism:** Low | **Side effects:** Attempts a write but should create no file

**Prerequisites**

- Permission Mode is `default`; confirm that `qoder-sdk-showcase-denied.txt` does not exist.

**Input and procedure**

```text
Use the file-writing tool to create qoder-sdk-showcase-denied.txt with the content SHOULD_NOT_EXIST. Do not use Bash.
```

1. On the first Approval, enter `Product trial: deny write` as the denial reason.
2. Leave Also stop the current turn (`同时停止当前轮次`) unchecked and deny the request.
3. Send the same prompt again. On the new Approval, select Also stop the current turn (`同时停止当前轮次`), deny it, and compare the two turns.
4. Send an ordinary read-only question to confirm that the session remains usable.

**Expected result**

- No file is created. The current turn shows permission-denied/unable-to-complete state rather than a global connection error.
- Turn behavior differs between `interrupt: false` and `true`; the session remains usable after denial.

**SDK mapping and evidence**

- `PermissionResult`: `behavior: "deny"`, `message`, and `interrupt`.
- The user's reason returns to the Tool flow; the browser receives bounded and redacted error text.

**Failure criteria and cleanup**

- Appearance of the target file is a severe failure. Record the Tool, Permission Mode, and Raw Event.
- If an environment fault creates the file, delete it immediately and stop write trials in that session.

## CASE-05 Structured AskUserQuestion

> **Runtime:** Real SDK | **Evidence:** Model behavior + direct callback | **Determinism:** Low | **Side effects:** One real model turn; no file changes

**Prerequisites**

- The session is idle with no other pending Approval or elicitation.

**Input and procedure**

```text
Before answering, you must use the AskUserQuestion tool to ask one single-choice question. Use the title "Inspection scope", the question "What should this inspection cover?", and the options "README only" and "Entire project". After receiving my answer, summarize only the scope I selected. Do not modify files.
```

1. Select an option or enter a custom answer.
2. Click Submit Answer (`提交回答`) and wait for the Agent to continue.

**Expected result**

- A structured Agent Question (`Agent 提问`) card appears instead of a plain-text question.
- The Agent remains waiting before submission, continues only once afterward, and gives a final response consistent with the selection.

**SDK mapping and evidence**

- Whether the model selects `AskUserQuestion` is model behavior.
- Once triggered, the Demo recognizes the input in `CanUseTool` and directly submits the answer through `PermissionResult.updatedInput`.

**Failure criteria and cleanup**

- No structured card, duplicate submission, answer mismatch, or a session permanently stuck in `requires_action` is a failure.
- No additional cleanup.

## CASE-06 Call the Built-In MCP Server

> **Runtime:** Real SDK | **Evidence:** Model behavior + message stream | **Determinism:** Low | **Side effects:** Real model plus read-only in-process MCP Tool; does not read file contents

**Prerequisites**

- The MCP tab in SDK Console shows `showcase_project` as connected.

**Input and procedure**

```text
Use only the list_project_entries tool provided by the showcase_project MCP Server to list the current project's top-level files and directories. Do not use Bash, Glob, Read, or any other file tool. Finally, state the name of the MCP tool you called.
```

1. Inspect the MCP Tool row and expanded result in the conversation.
2. Compare the top-level names and types with the Workspace.

**Expected result**

- The model calls the Tool corresponding to `mcp__showcase_project__list_project_entries` instead of another file Tool.
- The result contains only top-level names/types, not file contents. The read-only `always_allow` Tool normally requires no write Approval.

**SDK mapping and evidence**

- `createSdkMcpServer()`, `tool()`, `Options.mcpServers`, and `Query.mcpServerStatus()`.
- Connection status is read directly; whether the model uses the requested Tool remains model behavior.

**Failure criteria and cleanup**

- If the MCP tab is disconnected, record a configuration/runtime failure. If it is connected but the model does not use the Tool, record a model-guidance problem rather than immediately failing the MCP adapter.
- No cleanup for the read-only in-process Tool.

## CASE-07 Observe Hooks and Raw Events

> **Runtime:** Real SDK | **Evidence:** Message stream + callback observation | **Determinism:** Medium | **Side effects:** Reads projected diagnostics only; depends on a previous real call

**Prerequisites**

- Complete one Tool call in CASE-03 or CASE-06 and make sure SDK Console can be opened.

**Input and procedure**

1. In Hooks, find records such as `SessionStart`, `UserPromptSubmit`, `PreToolUse`, and `PostToolUse`.
2. Distinguish `source: "callback"` / `phase: "observation"` from `source: "sdk-event"`, and inspect hook-id correlation.
3. In Raw Events, expand Assistant, Tool, result, or system messages.
4. Inspect how credential fields such as token, Authorization, and cookie, and oversized MCP metadata, are projected.

**Expected result**

- Callback observations and SDK lifecycle records remain two valid sources and are not incorrectly merged.
- Raw Events help explain semantic ordering in the main UI.
- Credential-shaped values are redacted; oversized values are bounded by depth, node, byte, and count limits.

**SDK mapping and evidence**

- `Options.hooks`, `HookCallback`, `HookJSONOutput`, `includeHookEvents`, and the SDK message stream.
- Browser bounding/redaction is Showcase infrastructure, not UI automatically produced by the SDK.

**Failure criteria and cleanup**

- Plaintext credentials reaching the browser is a severe failure. If a Hook is missing, first confirm whether the runtime emitted the corresponding event.
- No additional cleanup.

## CASE-08 Start and Inspect a Subagent

> **Runtime:** Real SDK | **Evidence:** Model behavior + message stream + direct catalog | **Determinism:** Low | **Side effects:** Starts a real Subagent; the prompt is read-only

**Prerequisites**

- The runtime supports the `Agent` Tool and the session is idle.

**Input and procedure**

```text
You must use the Agent tool to start a read-only subagent. Ask it to inspect README and package.json in the current project and return a three-point summary. The main Agent must not call Read, Glob, or Bash itself.
```

1. Wait for an `Agent` Tool to appear in the main conversation.
2. Click the Tool to open Subagent details and expand its internal Tools.

**Expected result**

- Intermediate Assistant/Tool records from the Subagent do not enter the main conversation.
- Details show the task instruction, Assistant messages, and internal Tools in the correct order. Closing details does not affect the session.

**SDK mapping and evidence**

- Realtime `parent_tool_use_id` separates main-agent and subagent records.
- Details directly read public history through `listSubagents(sessionId, options)` and `getSubagentMessages(sessionId, agentId, options)`.

**Failure criteria and cleanup**

- Duplicated Subagent internals in the main conversation, details attached to the wrong Tool, or the browser scanning SDK transcript files is a failure.
- No local-file cleanup; the Subagent record remains with the session.

## CASE-09 Background Shell Task and Foreground Conversation

> **Runtime:** Real SDK | **Evidence:** Model behavior + Task message stream | **Determinism:** Low | **Side effects:** Starts a local `sleep` process for up to 300 seconds; cleanup is mandatory

**Prerequisites**

- The Workspace permits Bash. You can confirm and stop the process after the trial.

**Input and procedure**

Send first:

```text
Use Bash to start a background Shell task that runs sleep 300. As soon as the task has started, reply with BACKGROUND_STARTED. Do not wait for it to finish and do not stop it immediately.
```

After the reply, send:

```text
Do not wait for or stop the background task. Reply with FOREGROUND_CHAT_OK only.
```

Finally, send:

```text
Stop the sleep 300 background task you started. Confirm that it is no longer running, then reply with BACKGROUND_STOPPED.
```

**Expected result**

- The first turn does not wait 300 seconds, and the second turn completes while the background task exists.
- Raw Events may contain `task_started`, `task_updated`, `background_tasks_changed`, or `task_notification`; the combination depends on the runtime.
- No `sleep 300` process remains after the final turn.

**SDK mapping and evidence**

- This case primarily proves model behavior and the SDK Task message stream.
- “Run in the background” in natural language does not mean the UI called `Query.backgroundTasks(toolUseId)`. “Stop” does not mean it called `Query.stopTask(taskId)`.
- Server routes/services and the API client adapt both methods, but **the current product has no reachable Task control**.

**Failure criteria and cleanup**

- A blocked foreground, clearly mismatched Task state, or an unstopped process is a failure.
- Independently confirm and terminate `sleep 300`; do not rely only on the Assistant's “stopped” statement.

## CASE-10 Queue and Cancel a Message While Running

> **Runtime:** Real SDK | **Evidence:** Direct interface + message stream | **Determinism:** Low (timing-sensitive) | **Side effects:** Starts a local `sleep` for up to 20 seconds and makes real model turns

**Prerequisites**

- The session is idle and Bash is available.

**Input and procedure**

Send first:

```text
Use Bash to run sleep 20 in the foreground. After the command finishes, reply with LONG_TURN_DONE.
```

Immediately send while it is running:

```text
This is a queued-message test. Reply with QUEUED_MESSAGE_DONE only.
```

Before the second message is processed, click Cancel Queued Message (`取消排队消息`).

**Expected result**

- Input remains available while the session is running; the second message shows waiting/processing state.
- The application queue cancels a locally undelivered item. If already yielded to the SDK, the application calls `cancelAsyncMessage(uuid)`.
- If the SDK has already processed it, the UI clearly states that it can no longer be cancelled. Queue state does not leak into another session.

**SDK mapping and evidence**

- `AsyncIterable<SDKUserMessage>`, `priority`, `shouldQuery`, and `cancelAsyncMessage()`.
- `delivered` means transport delivery only. The SDK may combine inputs, and results do not identify a unique source UUID.

**Failure criteria and cleanup**

- The original message being overwritten, an unexplained execution after cancellation, or any result clearing every input is a failure.
- Wait for `sleep 20` to end. If interruption leaves it behind, stop the process manually.

## CASE-11 Model, Permission Mode, and Context

> **Runtime:** Real SDK | **Evidence:** Direct interface | **Determinism:** High (subject to runtime capability) | **Side effects:** Changes settings for the current session; does not send a model message by itself

**Prerequisites**

- The current session is live and the runtime can return at least one Model.

**Input and procedure**

1. Enter `/model` in the Composer, choose the suggestion, and switch to an available Model.
2. Enter `/permissions` and inspect `default`, `acceptEdits`, and `auto` in turn.
3. Enter `/context`, then enter `/context extra`.
4. Enter `/mcp`.
5. Inspect conversation history.

**Expected result**

- `/model` and `/permissions` focus their controls; the current value is visible after selection.
- `/context` refreshes the Context indicator; the variant with an argument shows a local error.
- `/mcp` opens the MCP tab in SDK Console.
- These product-control commands do not become user messages. Failures belong to their controls instead of a global banner.

**SDK mapping and evidence**

- `getAvailableModels({ fetchStrategy: "live" })`, `setModel()`, `setPermissionMode()`, `getContextUsage()`, and `mcpServerStatus()`.

**Failure criteria and cleanup**

- A setting leaking to another session, a control command entering the transcript, or a local failure becoming a global disconnect is a failure.
- Restore Permission Mode to the value required by later cases.

## CASE-12 Commands, Skills, and Prompt Suggestions

> **Runtime:** Real SDK | **Evidence:** Direct interface + message stream | **Determinism:** Medium | **Side effects:** Selecting a Skill may submit real input; clicking a Suggestion should not submit

**Prerequisites**

- Session initialization is complete. Finish one model turn first if you want to observe a dynamic Prompt Suggestion.

**Input and procedure**

1. Enter `/` in an empty Composer and browse suggestions with the keyboard.
2. Inspect the fixed product commands `/context`, `/model`, `/mcp`, and `/permissions`.
3. Compare with Skills in SDK Console and, when the runtime supports them, inspect `compact` / `compress` / `summarize`.
4. After a turn completes, click one Prompt Suggestion without sending it.

**Expected result**

- Only SDK Commands/Skills with an execution policy are advertised.
- Selecting, filling, and sending a Suggestion are three separate actions; clicking only fills the draft.
- The active keyboard option always remains visible.

**SDK mapping and evidence**

- `promptSuggestions: true`, `initializationResult()`, `supportedCommands()`, and the `prompt_suggestion` SDK message.

**Failure criteria and cleanup**

- Advertising a command that cannot execute, clicking a Suggestion and automatically invoking the model, or joining Suggestions into one message is a failure.
- Clear the draft; no additional cleanup.

## CASE-13 Additional Directories and `@ Files`

> **Runtime:** Real SDK + Showcase local infrastructure | **Evidence:** Direct interface | **Determinism:** High | **Side effects:** Expands allowed directories for the current Query; local scans return paths only

**Prerequisites**

- Prepare a dedicated additional directory without sensitive files.

**Input and procedure**

1. In Settings, click Add Directory (`添加目录`) and select the dedicated directory with the native picker.
2. Return to the Composer, enter `@` plus part of a filename, and select a suggestion without sending.
3. Change the search text quickly and observe that a stale result does not replace a newer result.

**Expected result**

- SDK-accepted directories appear in the allowed list.
- Suggestions can come from the Workspace or additional directory and insert paths only, without reading content or calling the model.
- Search stays within bounds; stale requests are debounced/aborted.

**SDK mapping and evidence**

- Direct SDK interface: `Query.addDirectories(directories)`.
- Native selection, canonicalization, the 200 ms debounce, cancellation, Workspace-first ordering, shared cross-root budget, and `@ Files` UI are all Showcase implementation, not SDK file search.

**Failure criteria and cleanup**

- Returning an out-of-root path, leaking content, escaping through a symlink, or allowing an older result to replace a new query is a severe failure.
- The allowed directory may remain until the session ends. Delete the dedicated session when it is no longer needed.

## CASE-14 Manage, Resume, and Fork Sessions

> **Runtime:** Real SDK | **Evidence:** Direct catalog + Query resume | **Determinism:** High | **Side effects:** Changes session metadata, creates a fork, and can delete session records at the end

**Prerequisites**

- Use a dedicated trial session with at least one completed turn.

**Input and procedure**

1. Open `…` on the session row and rename it manually. Then try Generate Title with SDK (`使用 SDK 生成标题`).
2. Add a tag, run `Fork`, and confirm that the original session remains.
3. Refresh and select the original session and fork separately.
4. Run Delete Record (`删除记录`) on a dedicated session.

**Expected result**

- Each operation affects only the selected session, and a generated title persists after completion.
- The fork has an independent id/history and does not modify the original history.
- Both restore after refresh. Deleting a session record does not delete Workspace files.

**SDK mapping and evidence**

- `listSessions()`, `getSessionInfo()`, `getSessionMessages()`, `renameSession()`, `tagSession()`, `forkSession()`, and `deleteSession()`.
- `generateSessionTitle(description, { persist: true })`; Query recovery uses `Options.resume`.

**Failure criteria and cleanup**

- A menu affecting an adjacent row, a fork overwriting the original, filesystem content being deleted, or recovery losing the first message is a failure.
- Delete unneeded original/fork trial records. Manage the Workspace directory separately.

## CASE-15 Account, Agents, and Plugins

> **Runtime:** Real SDK | **Evidence:** Direct interface | **Determinism:** High/medium (depends on account and runtime) | **Side effects:** Reads account/usage; Plugin reload refreshes runtime extensions

**Prerequisites**

- The session is live and the current account permits the relevant capability.

**Input and procedure**

1. Inspect Agents in SDK Console.
2. In Plugins, click Reload Plugins (`重新加载 Plugins`).
3. In Account, inspect the account, Credits/Usage, and SDK/CLI versions.

**Expected result**

- Switching tabs sends no model message.
- Plugins are reread after reload; unavailable capabilities show a local error.
- The browser receives only redacted account fields required for display.

**SDK mapping and evidence**

- `supportedAgents()`, `listPlugins()`, `reloadPlugins()`, `accountInfo()`, `getUsageInfo()`, and `initializationResult()`.

**Failure criteria and cleanup**

- A secret/token appearing in the browser, a capability failure crashing the session, or a tab operation polluting the transcript is a failure.
- No local cleanup. Record whether Plugin reload had environment side effects.

## CASE-16 Remote MCP, OAuth, and Elicitation

> **Runtime:** Real SDK + a trusted remote MCP supplied by the tester | **Evidence:** Direct interface + message stream + possible model behavior | **Determinism:** Low | **Side effects:** Network and OAuth/remote-server state; may call a remote Tool

**Prerequisites**

- Configure a dedicated, trusted, disposable MCP server through `QODER_WEBUI_MCP_CONFIG_FILE`.
- The built-in `showcase_project` does not require OAuth or initiate elicitation, so it cannot complete this case.

**Input and procedure**

1. Observe connected, authentication-required, or failed status in the MCP tab.
2. If OAuth is required, open the authorization address and submit the callback URL.
3. Trigger the test server's form or URL elicitation and try accept, deny, and cancel.
4. Use Reconnect (`重连`) and verify that it affects only the current session Query.

**Expected result**

- Silent OAuth success shows no unnecessary action; a URL/callback flow appears only when user action is required.
- Elicitation uses a dedicated inline card and is not submitted twice after resolution.
- The browser receives only a protocol-validated authorization URL and redacted, bounded MCP status. Remote headers, subprocess environments, and OAuth tokens never reach it.
- The callback URL pasted by the user exists only in component-local input and one validated submission request. The input is cleared after success, and the callback URL does not enter a snapshot, realtime event, or diagnostic record.

**SDK mapping and evidence**

- `mcpServerStatus()`, `mcpAuthenticate()`, `mcpSubmitOAuthCallbackUrl()`, `Options.onElicitation`, and `ElicitationResult`.

**Failure criteria and cleanup**

- Loading untrusted configuration, projecting credentials to the browser, reconnecting the wrong session, or accepting an unvalidated callback is a severe failure.
- Revoke test OAuth authorization, stop the test MCP server, and remove temporary configuration and tokens.

## CASE-17 Preview and Execute a Checkpoint

> **Runtime:** Real SDK | **Evidence:** Direct interface | **Determinism:** Medium/high (depends on rewind capability) | **Side effects:** May revert Workspace files and/or conversation history; run only in a dedicated directory

**Prerequisites**

- Use a dedicated Workspace and back up important changes.
- The session is live and idle, and every Approval, AskUserQuestion, and MCP elicitation has been resolved.
- Conversation/both can be selected only when initialization capabilities support full-session rewind; otherwise test files only.

**Input and procedure**

1. Complete a turn containing later Assistant or Tool records. To verify file rewind, first create the dedicated file in CASE-03.
2. Click `Checkpoint` on the target user message.
3. Use Tab/Shift+Tab to verify the focus trap. Press Escape to close and return focus to the trigger, then reopen it.
4. Select files, conversation, or both and click Preview Impact (`预览影响`).
5. Inspect files, insertions, deletions, failed items/rejection reasons; confirm that nothing has been reverted yet.
6. Click Execute Checkpoint (`执行 Checkpoint`).
7. Try to reuse the old preview. Then create another preview, send a new message, and try to execute it. Both stale previews must be rejected.
8. At narrow width, verify that the page does not scroll horizontally and that focus can continue from the original message after closing.

**Expected result**

- Execution is unavailable without a dry run, and the preview matches scope/capability.
- Success shows `success`; partial file failure shows `partial` and failed paths.
- Conversation scope retains the target user message and reloads later records from persistent SDK history.
- Busy, expired, revision-changed, and already-consumed errors appear in the dialog without a duplicate global command failure.
- Realtime state and a per-session snapshot converge to the same final semantics.

**SDK mapping and evidence**

- Files: `rewindFiles(userMessageId, { dryRun })`.
- Conversation/both: `rewind(userMessageId, { scope, dryRun })` and `RewindScope`.
- The idle gate, revision binding, single-use previews, sibling invalidation, mutation fence, and `conversation.replaced` are Showcase safety policies, not UI automatically provided by SDK rewind.

**Failure criteria and cleanup**

- Executing without a preview, reusing a stale preview, interleaving concurrent send and rewind, or deleting browser rows without rereading history is a failure.
- Verify files and transcript, then clean up the dedicated file and session. If the rewind impact is uncertain, stop using the Workspace and restore from backup.

## Capabilities That Are Not Evidence of a Direct UI Call

### Task Controls

The server's [`runtime-routes.ts`](../src/server/api/runtime-routes.ts) and [`runtime-capability-service.ts`](../src/server/sdk/runtime-capability-service.ts), and the browser's [`api-client.ts`](../src/client/transport/api-client.ts), adapt:

- `Query.backgroundTasks(toolUseId?)`
- `Query.stopTask(taskId)`

The current React product has no reachable Task list or control entry point. CASE-09 therefore proves model behavior and the Task message stream only; it cannot claim that the user directly called these methods from the UI.

### Other Query Methods Not Exposed

[`query-port.ts`](../src/server/sdk/query-port.ts) intentionally declares only the subset of SDK `Query` used by product services. Learn capabilities absent from the port through the public SDK reference and focused samples. Even when a method exists in the port, it can be described as a product feature only after it has a reachable UI, product policy, error ownership, and deterministic tests.

## Product Feedback Template

| Field | Example |
| --- | --- |
| Case | CASE-06 MCP Tool |
| Runtime | Real SDK / fixture |
| Result | Pass / partial pass / fail / unsupported by environment |
| Evidence level | Direct interface / message stream / model behavior |
| Actual behavior | MCP connected; the model selected the requested Tool on the second attempt |
| Determinism variance | The prompt was not followed on the first attempt, but connection and Tool events were correct |
| Side effects and cleanup | Read-only; no additional cleanup |
| Discoverability | Easy / moderate / difficult |
| State clarity | Clear / missing wait indicator / error shown in the wrong place |
| Evidence attachment | Screenshot, Raw Event type, session title |
| Requested improvement | Show the MCP Server name in the Tool row |

During a consolidated review, focus on these questions:

1. Which SDK capabilities belong in the ordinary product UI, and which should remain in SDK Console?
2. Can Tool, Approval, Subagent, MCP, and Task states be distinguished?
3. Does an error appear in the turn/control that owns it and explain the next action?
4. Which capabilities can be discovered only through a prompt, and do they need an explicit entry point?
5. Can UI behavior be traced quickly to an adapter in the [SDK capability map](SDK_CODE_TOUR.md#capability-map)?
6. Which local application infrastructure could be mistaken for an SDK-provided capability?

## Developer Verification Boundary

Manual trials do not replace deterministic regression tests, and fixture regression does not replace real-account verification. Run `npm run check` before publishing by default. Run the real smoke test only when external SDK calls are explicitly intended. See [Verification in the root README](../README.md#verification) for complete commands, deadlines, and cleanup semantics.
