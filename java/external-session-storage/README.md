# External session storage with Redis or PostgreSQL

Resume a session on another host from a transcript kept in an external store.

| Backend | Adapter | Run |
| --- | --- | --- |
| Redis lists, hashes, and Lua scripts | [`RedisSessionStore.java`](src/main/java/com/qoder/samples/storage/RedisSessionStore.java) | `mvn compile exec:java -Dexec.args='redis "/path/to/repository"'` |
| PostgreSQL rows and transactions | [`PostgresSessionStore.java`](src/main/java/com/qoder/samples/storage/PostgresSessionStore.java) | `mvn compile exec:java -Dexec.args='postgres "/path/to/repository"'` |
| The SDK's `InMemorySessionStore` | none | `mvn compile exec:java -Dexec.args='memory "/path/to/repository"'` |

[`SessionHandoff.java`](src/main/java/com/qoder/samples/storage/SessionHandoff.java)
runs the same end-to-end handoff with whichever store is selected:

```text
host A                         shared store                         host B
CLI process 1    -- append --> Redis/PostgreSQL <-- load --    CLI process 2
       |                                                          |
 creates session                                              resumes session
```

The application asks host A to remember a unique marker, confirms that the
store holds the transcript, resumes the session from the store in a second CLI
process, and verifies that host B returns the marker. Each host has its own
`QoderClient`; the store is the only thing they share.

## Requirements

Use JDK 11 or later (17 recommended), Maven 3.6.3 or later, and
`QODER_PERSONAL_ACCESS_TOKEN` from your environment. The standalone POM resolves
`com.qoder.sdk:qoder-agent-sdk:0.2.4`, Jedis 8.0.2, and the PostgreSQL JDBC
driver 42.7.14 from Maven Central and compiles for Java 8.
Leave `QODERCLI_PATH` unset to use the SDK's verified, managed CLI 1.1.80.
See [Java runtime notes](../README.md#runtime); CLI 1.1.81+ is incompatible
with this SDK's separate-process mode.

Runtime queries use your account and may consume credits. The store receives
the full transcript, including prompts and responses. Both hosts must use the
same absolute workspace path, because the SDK derives the project part of a
transcript key from it. Tools are disabled and each query is limited to one turn.

## Run

### Without a database

```bash
mvn compile exec:java -Dexec.args='memory "/path/to/repository"'
```

This runs the handoff against the SDK's reference store, shared by both hosts
inside one JVM. It shows the SDK calls and the two CLI processes, not durable
storage.

### Redis

Start Redis:

```bash
docker run --rm --name qoder-session-redis \
  -p 6379:6379 \
  redis:7-alpine
```

In another terminal:

```bash
mvn compile exec:java -Dexec.args='redis "/path/to/repository"'
```

The default connection is `redis://127.0.0.1:6379`. Override it when needed:

```bash
export QODER_SAMPLE_REDIS_URL="redis://127.0.0.1:6379"
```

### PostgreSQL

Start PostgreSQL:

```bash
docker run --rm --name qoder-session-postgres \
  -e POSTGRES_USER=qoder \
  -e POSTGRES_PASSWORD=qoder \
  -e POSTGRES_DB=qoder_session_store \
  -p 5432:5432 \
  postgres:17-alpine
```

In another terminal:

```bash
mvn compile exec:java -Dexec.args='postgres "/path/to/repository"'
```

The default connection uses the development credentials from the Docker
command. Override it when needed, in the URL form the TypeScript and Python
samples use:

```bash
export QODER_SAMPLE_POSTGRES_URL="postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store"
```

The sample converts that URL for JDBC and never prints it.

## SessionStore in the Java SDK

The application code needs only a store instance:

```java
SessionOptions.builder()
        .workingDirectory(workspace)
        .sessionStorage(SessionStorage.external(store))
        .resume(sessionId)
        .build();
```

`client.sessions(options)` returns a repository that reads and deletes
transcripts in the same store without starting a CLI process.

The Java `SessionStore` contract asks more of an adapter than appending and
loading entries. Both adapters implement all of it:

| Requirement | Meaning |
| --- | --- |
| Ordering | `load()` returns entries in append order, each raw JSON line byte for byte |
| Idempotency | A batch whose operation ID was already applied returns the original result and stores nothing |
| Versions | A batch with an expected version is rejected with the current version when they differ |
| UUID conflicts | An entry UUID stored with identical JSON is skipped; with different JSON the batch is rejected. An empty-string UUID counts; only a missing or non-string one does not |
| Isolation | Operation IDs, UUIDs, and versions are separate for every project, session, and subpath |
| Serialization | Batches are atomic, and writers of one transcript are applied one at a time |
| Deletion | A deleted transcript is sealed: later appends fail and can never recreate it |
| No blocking | Store I/O runs on the adapter's own worker; failures arrive through the returned stage |

`listSessions()` includes child transcripts so that resume can restore them
with the root. `deleteSessionTree()` seals a session with all of its children,
including ones created after the deletion.

### Redis layout

`RedisSessionStore.java` is independently copyable and needs the SDK and Jedis.
Project keys, session IDs, and subpaths are base64url-encoded before they become
key segments. `<transcript>` is `<session>:main` or `<session>:child:<subpath>`.

```text
entries:<project>:<transcript>   list, raw JSON lines in append order
meta:<project>:<transcript>      hash: version, applied operation IDs, entry UUID digests
index:<project>                  set of the project's transcripts
sealed:<project>:<transcript>    marker of one deleted transcript
sealed:<project>:<session>       marker of a deleted session and all its children
```

Every write is one Lua script, which Redis runs atomically. The scripts build
some key names from their arguments, so they suit a standalone Redis and not a
Redis Cluster.

### PostgreSQL layout

`PostgresSessionStore.java` is independently copyable and needs the SDK and the
PostgreSQL JDBC driver. `ensureSchema()` creates four tables:

```text
qoder_session_entries      one row per entry; seq preserves append order
qoder_session_heads        current version of each transcript
qoder_session_operations   applied operation IDs with their original results
qoder_session_seals        deleted transcripts and sessions
```

Entries are `TEXT`, not `JSONB`: JSONB reorders keys and drops whitespace, and
the contract requires the original line. Every write is one transaction that
first takes an advisory lock for its session. The adapter uses a single
connection, which only its worker thread touches.

## Differences from the TypeScript and Python samples

- One entry class takes the backend as an argument, and the adapters are
  separate files. The `memory` backend exists only in Java.
- The TypeScript and Python samples delete host A's local transcript before
  host B starts. Java SDK 0.2.4 has no API for CLI-local history, so this sample
  leaves it in place. It is not used: with an external store, the SDK restores
  the transcript from the store into a private directory and fails with
  `requested SessionStore transcript is absent or empty` when the store has no
  data for the session, even if local history exists.
- Cleanup deletes the transcript from the store only. Because deletion seals
  the session, its ID cannot be reused in that backend.

## Production considerations

These adapters are readable reference implementations, not production-ready
database packages. Before deployment:

- isolate tenants in the Redis prefix or the PostgreSQL table prefix or schema
- define retention, backup, encryption, and access control
- expire applied operation IDs and UUID digests, which the adapters keep for the
  life of a transcript, and decide how long seals of deleted sessions are kept
- replace the single connection and worker with a pool sized for your load
- monitor `MirrorErrorMessage`; the conversation can succeed even when an
  external write fails
- tune `SessionMirrorOptions` to the latency of your backend
- configure Redis persistence and eviction so that transcripts and seals survive
- add backend-specific load, concurrency, failover, and cleanup tests

SessionStore contains transcript history only. It does not store credentials,
application settings, file checkpoints, or external tool side effects.

## Verify

```bash
mvn -B -ntp clean verify
```

Tests use JUnit 4 and the published SDK's public API. They require no token or
CLI. This directory builds independently when copied out of the repository.

`SessionStoreContractTest` checks every row of the contract table, including
writers on several connections racing for one transcript. It always runs
against the SDK's `InMemorySessionStore`, which confirms that the expectations
match the reference implementation. It runs the same cases against Redis and
PostgreSQL only when their test URLs are set, and reports those cases as
skipped otherwise:

```bash
export QODER_SAMPLE_TEST_REDIS_URL="redis://127.0.0.1:6379"
export QODER_SAMPLE_TEST_POSTGRES_URL="postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store"
mvn -B -ntp clean verify
```

Each case uses its own Redis prefix or table prefix and removes it afterwards.
CI starts both services and sets both URLs. `SessionHandoffTest` covers the
session options, mirror-error handling, result handling, Redis key layout,
rejection of unsafe table prefixes and URLs, and failure delivery through the
returned stage.

For a real check, run the handoff with a disposable workspace and look for
`[app] External session handoff verified.` followed by
`[app] Deleted sample transcript from the store.`
