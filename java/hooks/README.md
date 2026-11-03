# Hooks

Observe lifecycle events, inject context, and gate Bash execution with a
`PreToolUse` hook.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.3` from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. Choose a workspace
whose contents you may send to Qoder; assistant output can include that content.
Do not put credentials in prompts or command arguments.

## Run

Git must be installed. From this directory:

```bash
mvn compile exec:java -Dexec.args='"/path/to/git-repository"'
```

The default prompt runs Git status, reads README.md, and describes the repository.
An optional prompt follows the workspace:

```bash
mvn compile exec:java -Dexec.args='"/path/to/git-repository" "Run exactly echo BLOCKED once. If denied, explain the denial without retrying."'
```

## Registered events

| Event | Response |
| --- | --- |
| `SessionStart` | Inject the read-only application context |
| `UserPromptSubmit` | Ask for observed facts |
| `PreToolUse`, matcher `Bash` | Allow exact Git status commands; deny others |
| `PostToolUse` | Observe completion and add context |
| `Stop` | Observe the event without overriding it |

Callbacks return JSON via `HookHandler`; event-specific fields belong inside
`hookSpecificOutput`, including `hookEventName`. Bash policy uses
`permissionDecision` and `permissionDecisionReason`. Missing or malformed
Bash inputs are denied. Other tools are outside this hook's matcher.

Only `Read` and `Bash` are visible and preapproved. The pre-tool hook further
restricts Bash to `git status --short` / `--porcelain`, optionally with
`--no-pager`. This is a sample policy for trusted local Git/repository
configuration, not an OS sandbox. The model is `auto`, with a four-turn limit.

Logs include event names and final counts, never hook payloads. Counts reflect
events actually sent by the CLI; registering a hook alone does not prove it
ran. Resources close on success and failure.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover structured hook responses, context injection, Bash matching,
command denial, malformed payloads, and neutral stop responses. A real run of
the default prompt should report pre/post-tool events; use the second command
to exercise the denial path.
