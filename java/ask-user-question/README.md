# Ask user question

Respond to the built-in `AskUserQuestion` tool from an application-owned
terminal interface.

```text
Agent -- questions --> canUseTool handler --> terminal UI --> user
  ^                                                       |
  +------------ updatedInput { questions, answers } ------+
```

The sample renders question headers, option labels, and descriptions. It
supports single-select questions, comma-separated multi-select answers, and
free-text answers.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.4` from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. Your answers are sent
to Qoder as tool input. Do not put credentials in prompts, answers, or command
arguments.

## Run

From this directory:

```bash
mvn compile exec:java
```

Press Enter to accept the first option, enter an option number such as `2`, or
enter comma-separated numbers such as `1,3` for a multi-select question. Text
that starts exactly one option label selects that option; any other text is
returned as a custom answer. An out-of-range number is rejected and asked again.

An optional prompt replaces the default one, which asks for an environment and a
set of validation checks:

```bash
mvn compile exec:java -Dexec.args='"Ask me which database to use, then recommend one."'
```

## Behavior

- `tools` exposes only `AskUserQuestion`. The tool is not preapproved, so the
  runtime sends each call to `canUseTool`.
- The handler validates the question objects, reads one answer per question,
  and returns `PermissionResult.allow(updatedInput)`. The updated input keeps
  every original field and adds an `answers` object keyed by the exact question
  text.
- Every tool other than `AskUserQuestion` is denied so the interaction stays
  focused. Malformed input, cancellation, and end of terminal input are denied
  with a reason instead of an answer.
- The model is `auto`, with a three-turn limit. The final result is printed once.
  Answers are counted only when the whole request is allowed; a run in which
  no answer reached the agent exits nonzero.

The handler blocks while it waits for the terminal. The SDK invokes it on its
callback lane, not on the thread that reads CLI output, so the stream keeps
flowing. SDK 0.2.4 fails a permission request that is still pending after
`controlRequestTimeoutMs`, 60 seconds by default; the sample raises that limit to
ten minutes. The setting applies to every control request of the session, so
choose a value that matches how long your interface may wait. Terminal input
cannot be interrupted: an answer typed after the request was cancelled is
discarded and reported as a denial.

Failures exit nonzero. Conditions the sample detects itself are printed as a
message; SDK failures report only the exception type, avoiding raw exception
details or credential logging. The cursor and client close on all paths.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover question parsing and malformed input, numeric, prefix, and custom
answers, invalid selections, preservation of the original input, denial of
other tools, cancellation, end of input, the session options, and result
handling.

For a real check, answers can be piped instead of typed:

```bash
printf '2\n1,3\n' | mvn -q compile exec:java
```

Look for both rendered questions, a summary that reflects the selected options,
and `Answered 2 question(s).` The exact model wording is not an assertion.
