# Tool permissions

Separate tool visibility, preapproval, and a host authorization callback.

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

The prompt asks for exactly `git --no-pager status --short`, then a short
explanation. The workspace defaults to the current directory.

## Policy

- `tools` exposes `Read`, `Glob`, `Grep`, and `Bash`.
- `allowedTools` preapproves only the three read tools.
- `canUseTool` handles requests that need host authorization, including Bash.
- The callback allows only exact `git status --short` / `--porcelain` commands,
  optionally with `--no-pager`, and removes other unreviewed input fields.
- Cancelled requests, other tools, malformed inputs, shell chains, redirections,
  and substitutions are denied.

The handler returns a completed future without terminal input or blocking work.
It prints only its allow/deny decision, never tool input. The final callback count
shows whether the runtime actually asked the host. Preapproved tools do not
necessarily call this handler. The model is `auto`, with a three-turn limit.

This is a narrow sample policy for a trusted local Git installation and
repository configuration, not an OS sandbox. The cursor and client close on
all paths; an unsuccessful or missing terminal result exits nonzero.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover command injection attempts, malformed input, cancellation,
input rewriting, and the distinction between visible and preapproved tools.
For a real check, use a small disposable Git repository and look for
`[permission] allowed` and a nonzero callback count.
