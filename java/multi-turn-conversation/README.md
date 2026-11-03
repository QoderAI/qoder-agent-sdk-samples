# Multi-turn conversation

Keep one interactive session open, observe turn completion, interrupt generation,
then close and resume the persisted conversation.

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

From this directory:

```bash
mvn compile exec:java -Dexec.args='"/path/to/repository"'
```

The workspace defaults to the current directory. Type a prompt, then use these
application commands:

| Command | Behavior |
| --- | --- |
| `/status` | Show whether the session is idle, generating, or closed |
| `/wait` | Wait for the current turn's result and report its outcome |
| `/interrupt` | Request interruption while generation is active |
| `/close` | Close the runtime session while retaining its ID |
| `/resume` | Reopen the closed session from CLI-local history |
| `/exit` | Close resources and exit, including during generation |

Try: ask it to remember an invented word, enter `/wait`, `/close`, `/resume`,
then ask for that word and enter `/wait` again. Resume requires the same workspace,
user home, and persisted CLI history. This sample saves conversation content in
the CLI's local storage; it keeps the resume ID only for this application run.
Because the SDK forwards only allowlisted environment variables to the CLI child,
the sample passes `HOME` explicitly so the CLI can locate that local history.

## Lifecycle

The terminal thread controls the session, and one worker consumes its cursor.
`send()` completion means input was accepted; a `ResultMessage` marks turn
completion. A result does not close the cursor. A new prompt during generation
is rejected; wait or interrupt first. After `/interrupt`, use `/wait` before
sending another prompt. An acknowledged interruption may produce an error
result, which is reported as such. On this path the application closes and
automatically resumes the session from CLI-local history before accepting the
next prompt. Direct continuation after an interrupted error stalled during
verification with SDK 0.2.3 / CLI 1.1.80, so the sample uses this recovery path.
If recovery fails, the application exits nonzero. Unknown outcomes still fail.
An acknowledgement confirms the control request, not that all generation
stopped: an interrupt can race with turn startup or completion, and a successful
result can still follow. The printed result is the outcome to inspect.

`/interrupt` is a portable terminal command, not a Ctrl+C signal handler.
`/wait` blocks terminal input until the turn finishes. End-of-input waits for
the accepted turn; `/exit` closes immediately. Closing the session also closes
the cursor; closing the application stops its worker and client.

Only `Read`, `Glob`, and `Grep` are visible and preapproved. The model is
`auto`, with a maximum of eight model turns per request.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover result boundaries across two turns, missing/error/unknown results,
interruption outcome handling, and persistent resume configuration.
