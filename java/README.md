# Java samples

Start with [Quickstart](quickstart), a repository-aware query using the published
Global SDK `com.qoder.sdk:qoder-agent-sdk:0.2.4` from Maven Central.

| Sample | Focus |
| --- | --- |
| [Quickstart](quickstart) | One repository-aware query |
| [Multi-turn conversation](multi-turn-conversation) | Turn completion, interruption, close, and resume |
| [Streaming chat](streaming-chat) | Text deltas and multiple turns on one cursor |
| [Tool permissions](tool-permissions) | Visibility, preapproval, and runtime authorization |
| [Ask user question](ask-user-question) | Structured questions answered from a terminal |
| [Hooks](hooks) | Lifecycle events, context injection, and tool policy |
| [Code review](code-review) | Bounded Git diffs and read-only review |
| [Model selection](model-selection) | Runtime catalog, parameter selection, and model policy |
| [Custom tools](custom-tools) | Application functions served as in-process MCP tools |
| [Subagents](subagents) | Delegation to agents declared in session options |
| [External session storage](external-session-storage) | Session handoff through Redis, PostgreSQL, or the reference store |

## Requirements

- JDK 11 or later for building (JDK 17 recommended) and Maven 3.6.3 or later.
- Sources compile with `--release 8`; the SDK supports JRE 8 or later.
- Runtime queries require `QODER_PERSONAL_ACCESS_TOKEN` and network access to
  Qoder. Building and running unit tests require no token or CLI.

Each sample has a standalone POM. You can copy a sample directory outside this
repository and build it without the aggregator or SDK source checkout.

## Build and test

From this directory:

```bash
mvn -B -ntp clean verify
```

The root POM aggregates samples; it is not their parent. CI builds on JDK 11 and
17. Each sample POM pins its SDK version.
Use a fresh Maven local repository when verifying published SDK compatibility:

```bash
mvn -B -ntp -Dmaven.repo.local=/path/to/empty/maven-cache clean verify
```

Use Maven's default Central repository or a verified Central mirror. Do not
install a local SDK build under the published version before this check.

## Runtime

The SDK downloads and verifies its pinned CLI on first use and reuses the cache
on later runs. Leave `QODERCLI_PATH` unset to use this managed runtime. SDK 0.2.4
uses a separate CLI process per query and pins CLI 1.1.80; it has no daemon API.
Do not override it with CLI 1.1.81 or later, which removes that process mode.

The default samples use Global credentials and artifacts. The CN core is a
separate artifact (`cn.qoder.sdk:qodercn-agent-sdk:0.2.3`) using
`QODERCN_PERSONAL_ACCESS_TOKEN`; never put both brands on one classpath.

## Verification record

On November 3, 2026, all seven samples passed the aggregate build and standalone
builds on macOS arm64 with JDK 11 and Global SDK 0.2.3. All 33 credential-free
tests passed (no failures, errors, or skips). Main and test classes have Java 8
bytecode (version 52). The SDK and its parent POM were resolved from Maven Central
into a fresh local cache; the JAR matched a separate Central download. Subsequent
builds reused that verified cache, without installing the SDK from source.

On November 6, 2026, the model selection sample changed how it disables tools
and how the policy callback validates parameters (see its
[README](model-selection#catalog-and-callback)). The aggregate build and the
standalone build passed on the same macOS arm64, JDK 11, and SDK 0.2.3 setup
with the verified cache; all 35 credential-free tests passed. The real query
below was not repeated after that change.

On November 9, 2026, the ask user question and external session storage samples
were added. On the same macOS arm64, JDK 11, and SDK 0.2.3 setup, the aggregate
build of all nine samples passed from an empty Maven cache with empty Maven
settings: all 83 tests passed with no failures, errors, or skips. The SDK,
Jedis 8.0.2, and PostgreSQL JDBC 42.7.14 jars matched the SHA-1 values published
on Central, and the new classes have Java 8 bytecode. That run had the test URLs
of the session store contract suite set, so its 30 cases covered the SDK's
`InMemorySessionStore`, `RedisSessionStore` on a local Redis 8.10.3, and
`PostgresSessionStore` on a local PostgreSQL 17.11, including writers on three
connections racing for one transcript. Without the test URLs the same build
passed with the 20 Redis and PostgreSQL cases skipped. The service containers
that the CI job configures (`redis:7-alpine` and `postgres:17-alpine`) were not
exercised locally.

On November 11, 2026, every sample moved to SDK 0.2.4, and the custom tools and
subagents samples were added on its new `InProcessMcpServer` and
`SessionOptions.agents` APIs. The 0.2.4 public API only adds to 0.2.3; no
existing sample code changed. On the same macOS arm64 and JDK 11 setup, the
aggregate build of all eleven samples passed from an empty Maven cache with
empty Maven settings: all 97 tests passed with no failures, errors, or skips
with the session store test URLs set (local Redis 8.10.3 and PostgreSQL 17.11),
and with the 20 Redis and PostgreSQL cases skipped without them. The SDK jar
matched the SHA-1 published on Central, its managed CLI is still 1.1.80, and
the new classes have Java 8 bytecode. Every sample was then run with real
authentication on 0.2.4; the table below records those runs. The interruption
scenario of the multi-turn conversation sample was not repeated. The CI service
containers were still not exercised locally.

Real queries used managed CLI 1.1.80 and synthetic repositories:

| Sample | Observed behavior |
| --- | --- |
| Quickstart | Read-only query through the documented Maven entry point summarized the synthetic README |
| Multi-turn conversation | Close/resume preserved a remembered word on 0.2.4. On November 3, active interruption returned an error, automatic close/resume recovered, and the next turn succeeded |
| Streaming chat | Two successful turns using one cursor, eight text deltas, no duplicated response |
| Tool permissions | One host callback allowed the Git status command |
| Ask user question | The agent asked both default questions; piped answers `2` and `1,3` were returned and the summary named Production, Unit tests, and Security scan. With input ending after the first answer, the request was denied and the run exited nonzero without counting an answer |
| Hooks | All five registered event types fired; a separate denied-command run had a pre-tool event and no post-tool event |
| Code review | Maven entry point reviewed a synthetic diff and found the introduced empty-array bug |
| Model selection | Runtime catalog supplied model/context choices; the policy callback ran and the queries succeeded with the interactive defaults and with `--defaults`, which returned `MODEL_OK` |
| Custom tools | For `payments-api` the recommendation cited revision `8f2a1c4` and incident `INC-1042`. For `search-api` both tools returned `Unknown service` error results, and the agent reported that it could not assess the release |
| Subagents | The CLI-local transcript shows one `Agent` call to `architecture-explorer` and one to `test-strategist`, and the plan reflected the empty synthetic workspace. With only `Agent` exposed at session level, the run failed because both agents' tool sets resolved empty; see the sample README |
| External session storage | `redis`, `postgres`, and `memory` backends: each store held 18 or 19 entries after host A, host B resumed in a second CLI process and returned the marker, and deletion left only the session's seal in Redis and PostgreSQL. On November 9, resuming a session against an empty store failed with `requested SessionStore transcript is absent or empty` while host A's local transcript still existed |

The [conversation notes](multi-turn-conversation#lifecycle) explain the observed
interrupt race and recovery behavior. Other platforms and the CN artifact were
not exercised; the CI matrix configures JDK 11 and 17 builds, but a local JDK 11
pass does not establish a JDK 17 CI result.
