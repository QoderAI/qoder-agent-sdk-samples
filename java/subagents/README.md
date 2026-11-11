# Subagents

Define specialized agents in session options and let the main agent delegate
work through the built-in `Agent` tool.

```text
main agent (prompted to delegate)
  |-- Agent --> architecture-explorer (Read, Glob, Grep, 5 turns)
  |-- Agent --> test-strategist       (Read, Glob, Grep, 5 turns)
  +-- synthesizes a migration plan
```

The sample registers an architecture explorer and a test strategist. Both
subagents receive only read-only repository tools. The main agent is prompted
to delegate every inspection and to synthesize their findings.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.4` from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. Choose a repository
whose contents you are permitted to send to Qoder; read-only tools do not
prevent data from being sent to the model. Never put a token in the prompt or
command-line arguments.

## Run

From this directory:

```bash
mvn compile exec:java -Dexec.args='"/path/to/repository"'
```

With no argument the sample inspects the current directory. The prompt is fixed:
it asks the main agent to map the repository through `architecture-explorer`,
to design verification for a major dependency upgrade through
`test-strategist`, and to synthesize a migration plan.

## Behavior

- `AgentDefinition.builder()` declares each agent with a description (when to
  delegate to it), a system prompt, the tools it may use, and a turn limit.
  Model and permission mode are left unset, so both agents inherit the
  session's. Only description and prompt are required.
- `SessionOptions.agents(Map)` sends the definitions in the initialize request.
  They exist for that session only; nothing is written to the CLI's agent
  directories. A definition named like a built-in agent replaces it for the
  session.
- The session exposes and preapproves `Agent`, `Read`, `Glob`, and `Grep`.
  A subagent's tools are taken from the session's tool set (CLI 1.1.80): a
  tool the session does not expose is unavailable to every agent, and an agent
  whose tool set resolves empty cannot start. Exposing only `Agent`, as the
  TypeScript and Python samples do, fails here with
  `Agent type 'architecture-explorer' is unavailable because its resolved tool
  set is empty`. Read-only tools are approved by the CLI without a `canUseTool`
  request, so the prompt, not a permission rule, keeps the main agent to
  delegation. The model is `auto`, with an eight-turn limit for the main
  agent.
- The SDK checks the agents the CLI reports at startup and fails the launch
  with `UnsupportedCliCapabilityException` when a declared agent is missing or
  was replaced by one the CLI already had under that name. The CLI drops every
  declared agent, without failing, when it rejects one of them.

Assistant text is printed as it arrives. Failures exit nonzero. Conditions the
sample detects itself are printed as a message; SDK failures report only the
exception type, avoiding raw exception details or credential logging. The cursor
and client close on all paths.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover the agent definitions, the session options that restrict the main
agent to delegation, workspace validation, the SDK's validation of definitions,
and result handling.

For a real check, run the sample against a small repository with no sensitive
content and look for a plan that references both agents' findings. The exact
model wording is not an assertion.
