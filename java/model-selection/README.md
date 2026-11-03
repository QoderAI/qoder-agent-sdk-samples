# Model selection

Read the live model catalog, choose a model and advertised context/reasoning
parameters, then apply the choice through a model policy callback.

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
mvn compile exec:java
```

Choose a displayed number or value; Enter accepts the displayed default.
An optional prompt can follow:

```bash
mvn compile exec:java -Dexec.args='"Explain runtime model discovery in one sentence."'
```

For a noninteractive check using the catalog defaults:

```bash
mvn compile exec:java -Dexec.args='--defaults "Reply with only MODEL_OK."'
```

## Catalog and callback

A discovery session calls `getAvailableModels()` and closes before waiting for
terminal input. Disabled models are excluded. There is no hardcoded list of
account-specific model IDs.

Optional metadata comes from `ModelInfo.raw()`: context windows combine
`availableContextWindows` and `context_config`; reasoning choices combine
`efforts` and `thinking_config.enabled.efforts`. Malformed entries are ignored.
Defaults must be present among advertised choices; otherwise the first valid
choice is used. Absent choices leave that parameter to the model default.

A second query installs `ModelSelection.policy(...)`. The callback validates
that the selected model remains enabled when a nonempty catalog is supplied,
then returns the cached `ModelPolicyResult` immediately. It never waits for
terminal input. Context and reasoning values are structured `parameters`,
not text appended to the prompt. The callback log confirms actual invocation.

The execution query exposes no tools and permits one turn. Empty catalogs,
unavailable selections, unsupported SDK/CLI capabilities, and unsuccessful
results fail explicitly; the sample does not guess unsupported capabilities.
Discovery and query resources close on success and failure.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

Tests cover both metadata formats, malformed fields, disabled models, input
selection, stale catalogs, and structured policy parameters. Real model choices
depend on your account and runtime; they are not stored as test fixtures.
