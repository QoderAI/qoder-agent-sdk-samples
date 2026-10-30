# Multi-turn conversation with CodeMode

An interactive terminal application with streaming replies, CodeMode child tools,
per-call permissions, interruption, and session resume. This CodeMode integration
is specific to the TypeScript example.

```text
terminal prompt -> SDK query -> model CodeMode / CodeModeWait
                                  |
                       +----------+----------+
                       |                     |
                    child A               child B
                       |                     |
                  permission A          permission B
                       |                     |
                  result A              progress / result B

SDK output -> tool display (keyed by each child tool_use_id)
transcript -> parent tool_use_result.calls[].hostResult
/resume    -> merge saved CodeMode + Wait deltas -> tool display
```

## Prerequisites and setup

Use Node.js 22 or later. Install dependencies in this directory:

```bash
npm install
```

The manifest declares SDK `^1.0.56`, but the CodeMode child-tool integration
requires matching SDK and CLI builds. SDK 1.0.56 uses the worker transport; a CLI
that has removed that transport rejects it with `sdk_worker_removed`. Selecting
a newer CLI alone is insufficient.

For development, build the SDK checkout containing the daemon transport and
child-tool protocol, then link that build into this example:

```bash
# In the SDK checkout:
npm run build
npm link

# In this example's directory:
npm link --no-save --package-lock=false @qoder-ai/qoder-agent-sdk
```

The matching CLI must emit `message_source: "host_tool"`,
`code_mode_tool_use_id`, and `tool_use_result.calls[].hostResult`. Select that
CLI build explicitly:

```bash
export QODERCLI_PATH="/absolute/path/to/qodercli/bundle/qodercli.js"
```

The app enables the CLI's existing CodeMode feature and selects
`settings.codeMode.mode: "only"`. It declares `CodeMode`, `CodeModeWait`, `Read`,
`Glob`, and `Grep`. There is no additional child-event subscription option. A CLI
that does not expose CodeMode and CodeModeWait is rejected at initialization.

For authentication, either set `QODER_PERSONAL_ACCESS_TOKEN` as described in the
[repository setup](../../README.md#setup), or use an existing Qoder CLI login.
The application uses `accessTokenFromEnv()` when the variable is set and
`qodercliAuth()` otherwise. Credentials are never printed.

```bash
npm start -- /path/to/repository
```

## Try a complete session

Ask for two independent reads, for example:

```text
you> Read README.md and package.json in parallel, then summarize their contents.
```

Each requested read has its own permission ID. Copy an ID from the displayed
request into `/allow ID` or `/deny ID`. Multiple pending requests can be answered
in either order. Only `Read`, `Glob`, and `Grep` are available to scripts; shell
execution and file modifications are not enabled.

The input prompt remains active while the model generates output or tools wait
for permission. CodeMode may return a running cell and use CodeModeWait to obtain
later results. All child calls keep the original CodeMode ID across these waits.

After a turn finishes, run `/tools`, `/close`, then `/resume`. Saved child results
are displayed again. A follow-up prompt continues the conversation. Press Ctrl+C
during generation to interrupt the current turn while keeping the query open.

| Command | Behavior |
| --- | --- |
| `/status` | Show query, turn, and session state |
| `/tools` | Show observed or restored tool calls and bounded result previews |
| `/allow ID` | Approve one pending read-only tool call |
| `/deny ID` | Deny one pending tool call; the script decides how to handle the error |
| `/close` | Close the query and cancel pending permissions, retaining its session ID |
| `/resume` | Restore saved tool details and open a query for the retained session |
| `/exit` | Close the query, shut down the SDK daemon, and exit |
| `/help` | Show commands |

## Message handling and persistence

- `index.ts` owns the input queue, SDK query, model text, and turn lifecycle.
- `permissions.ts` handles `canUseTool` using the existing `toolUseID` and abort
  signal. Permission handling does not depend on a tool card already existing.
- `tool-observer.ts` uses each call's ID to associate starts, progress, and results.
  `code_mode_tool_use_id` identifies the CodeMode root; `parent_tool_use_id` retains
  its existing Agent meaning. Same-name parallel tools remain independent.

Host child messages are display events. They do not become model text, finish a
turn, or enter the input queue. Result previews retain native `content`,
`is_error`, `tool_use_result`, and `tool_result_meta`. The observer can also display
the existing `tool_progress` payload, including MCP progress, if a configured
tool produces it; this example only declares repository read tools.

The app does not save a separate child-event log. On resume, `getSessionMessages()`
returns the existing parent results, and the observer merges `calls` by `callId`
in history order. A final Wait contains only changed calls, so earlier results
must be retained. Native execution success and script delivery errors are
displayed separately.

Recovery is limited to saved parent results. A call without a recorded final
result is shown as unfinished, rather than marked successful or executed again.
Older results without the new fields retain their normal parent-tool display.
This example preserves the session ID within the application process; it does
not add cross-process session selection or a new persistence format.

## Validation

```bash
npm run check
```

The check includes strict TypeScript checking and deterministic tests for parallel
calls, permission cancellation, late progress, and CodeMode/Wait history merging.
These tests do not require credentials or a model connection. The interactive
session above exercises the real SDK and selected CLI.
