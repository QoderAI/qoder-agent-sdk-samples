# Streaming chat

Print text deltas while reusing one live session and one message cursor across
multiple turns.

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
mvn compile exec:java -Dexec.args='--workspace "/path/to/repository"'
```

Type a prompt at `you>`. Enter an empty line, end-of-input, or `/exit` to finish.
For a scripted two-turn check:

```bash
mvn compile exec:java -Dexec.args='--workspace "/path/to/repository" "Remember BLUEBIRD; reply only BLUEBIRD." "Repeat the word I asked you to remember."'
```

## Message handling

`includePartialMessages(true)` exposes raw stream events. The renderer prints
only `text_delta` text and flushes it immediately; it ignores thinking and tool
argument deltas. If an assistant message already streamed text, its full text
is not printed again. Full-message delivery remains a fallback for messages
without text deltas.

Each turn reads through its own `ResultMessage`, then the same cursor is reused.
After the last turn the sample completes input and closes the cursor, session,
and client. Error or unknown results and EOF before a result fail the run.
The final line reports completed turns and the number of received text deltas;
zero deltas means full-message fallback, not proof of streaming.

Only `Read`, `Glob`, and `Grep` are visible and preapproved, using `auto`
and a six-turn limit. This example waits for each answer before accepting the
next prompt; use [Multi-turn conversation](../multi-turn-conversation) for
interactive interruption and resume.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover delta/full-message deduplication, non-text filtering, message and
turn boundaries, fallback rendering, and failure outcomes.
