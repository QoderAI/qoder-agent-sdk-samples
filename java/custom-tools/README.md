# Custom tools

Expose application functions to the agent as in-process MCP tools. This sample
implements a release-readiness assistant with two tools:

- `get_build_status`
- `get_open_incidents`

```text
Agent -- tools/call --> SDK --> InProcessMcpServer --> ReleaseData (data.json)
  ^                                                           |
  +------------------ text content, isError ------------------+
```

The server runs inside the application's JVM. No child process, port, or MCP
configuration file is involved.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.4` from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. Tool results are sent
to the model as tool output. Do not put credentials in tool results, prompts, or
command arguments.

## Run

From this directory:

```bash
mvn compile exec:java
```

An optional service name replaces the default `payments-api`:

```bash
mvn compile exec:java -Dexec.args='search-api'
```

The checked-in `src/main/resources/data.json` simulates application-owned
release data. Replace `ReleaseData.load()` with calls to your CI and
incident-management clients in a real application. With an unknown service the
tools answer with an error result, and the agent reports that it has no data.

## Behavior

- `InProcessMcpTool.of(name, description, inputSchema, handler)` defines each
  tool. The schema is a JSON Schema object; both tools take one required
  `service` string.
- `InProcessMcpServer.builder()` collects the tools under the server name
  `release_readiness`, and `McpServerConfig.inProcess(name, server)` registers
  it in `SessionOptions.mcpServers`.
- The CLI names an MCP tool `mcp__<server>__<tool>`. The session exposes and
  preapproves exactly `mcp__release_readiness__get_build_status` and
  `mcp__release_readiness__get_open_incidents`, so no `canUseTool` handler is
  needed and no other tool is available. The model is `auto`, with a four-turn
  limit.
- A handler returns a `CompletionStage<JsonValue>`. The sample returns an MCP
  result object, `{"content":[{"type":"text","text":...}]}`, with `isError`
  set when the service is unknown or the argument is invalid; the model sees
  the message and can recover. A handler that throws fails the call with a
  JSON-RPC error instead. A result without `content` is wrapped in a text block
  by the SDK.
- Handlers run on the SDK's callback lane and must be thread-safe. The release
  data is immutable, and the handlers complete immediately. A slow backend
  should complete the stage from its own executor rather than block.

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

Tests cover the release data and unknown services, the registered tools and
their schema, successful and error results from the handlers, `tools/list` and
`tools/call` served through the SDK's JSON-RPC channel, the session options,
and result handling.

For a real check, run the sample and look for a recommendation that cites
revision `8f2a1c4` and incident `INC-1042`. Run it with `search-api` to see the
agent report an unknown service. The exact model wording is not an assertion.
