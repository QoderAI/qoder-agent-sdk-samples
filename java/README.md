# Java samples

Start with [Quickstart](quickstart), a repository-aware query using the published
Global SDK `com.qoder.sdk:qoder-agent-sdk:0.2.3` from Maven Central.

| Sample | Focus |
| --- | --- |
| [Quickstart](quickstart) | One repository-aware query |
| [Multi-turn conversation](multi-turn-conversation) | Turn completion, interruption, close, and resume |
| [Streaming chat](streaming-chat) | Text deltas and multiple turns on one cursor |
| [Tool permissions](tool-permissions) | Visibility, preapproval, and runtime authorization |
| [Hooks](hooks) | Lifecycle events, context injection, and tool policy |
| [Code review](code-review) | Bounded Git diffs and read-only review |
| [Model selection](model-selection) | Runtime catalog, parameter selection, and model policy |

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
on later runs. Leave `QODERCLI_PATH` unset to use this managed runtime. SDK 0.2.3
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

Real queries used managed CLI 1.1.80 and a synthetic repository:

| Sample | Observed behavior |
| --- | --- |
| Quickstart | Read-only query through the documented Maven entry point |
| Multi-turn conversation | Close/resume preserved a remembered word; active interruption returned an error, automatic close/resume recovered, and the next turn succeeded |
| Streaming chat | Two successful turns using one cursor, eight text deltas, no duplicated response |
| Tool permissions | One host callback allowed the Git status command |
| Hooks | All five registered event types fired; a separate denied-command run had a pre-tool event and no post-tool event |
| Code review | Maven entry point reviewed a synthetic diff and found the introduced empty-array bug |
| Model selection | Runtime catalog supplied model/context choices; the policy callback ran and the query succeeded |

The [conversation notes](multi-turn-conversation#lifecycle) explain the observed
interrupt race and recovery behavior. Other platforms and the CN artifact were
not exercised; the CI matrix configures JDK 11 and 17 builds, but a local JDK 11
pass does not establish a JDK 17 CI result.
