# External session storage with Redis or PostgreSQL

Copy and run one self-contained sample for the storage backend used by the
application:

| Sample | Backend | Run |
| --- | --- | --- |
| [`redis_sample.py`](redis_sample.py) | Redis lists and indexes | `python redis_sample.py /path/to/repository` |
| [`postgres_sample.py`](postgres_sample.py) | PostgreSQL JSONB rows | `python postgres_sample.py /path/to/repository` |

Each file contains both a complete `SessionStore` adapter and the same
end-to-end handoff:

```text
host A                         shared store                         host B
local transcript  -- append --> Redis/PostgreSQL <-- load --  no transcript
       |                                                          |
 creates session                                              resumes session
       |
 local transcript is deleted before host B starts
```

The application asks Host A to remember a unique marker, deletes its local
transcript, resumes the session through the external store, and verifies that
Host B returns the marker.

Complete the [repository setup](../../README.md#setup), then:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Both samples use the same absolute workspace path for Host A and Host B.
Session storage uses the canonical workspace path to identify the project.

## Redis sample

Start Redis:

```bash
docker run --rm --name qoder-session-redis \
  -p 6379:6379 \
  redis:7-alpine
```

In another terminal:

```bash
python redis_sample.py /path/to/repository
```

The default connection is `redis://127.0.0.1:6379`. Override it when needed:

```bash
export QODER_SAMPLE_REDIS_URL="redis://127.0.0.1:6379"
```

`redis_sample.py` is independently copyable. It needs `qoder-agent-sdk` and
`redis`, and stores:

```text
entries:<project>:<session>:main       Redis list, append order
entries:<project>:<session>:child:*    Redis list, append order
sessions:<project>                     sorted set, modification time
subkeys:<project>:<session>            set of child transcript paths
```

Project keys, session IDs, and child paths are base64url-encoded before they
become Redis key segments.

## PostgreSQL sample

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
python postgres_sample.py /path/to/repository
```

The default connection uses the development credentials from the Docker
command. Override it when needed:

```bash
export QODER_SAMPLE_POSTGRES_URL="postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store"
```

`postgres_sample.py` is independently copyable. It needs `qoder-agent-sdk` and
`asyncpg`. The adapter creates `qoder_session_entries`: each transcript entry
is one JSONB row, the increasing `seq` column preserves replay order, and the
`(project_key, session_id, subpath, seq)` index supports loading main and child
transcripts.

## SessionStore behavior

The SDK-facing application code needs only a store instance:

```python
options = QoderAgentOptions(
    auth=access_token_from_env(),
    cwd=workspace,
    session_store=store,
    resume=session_id,
)

async for message in query(prompt=prompt, options=options):
    ...
```

`append()` receives newly committed entries. `load()` returns the complete
history for one key in append order. `list_sessions()`, `list_subkeys()`, and
`delete()` enable latest-session resume, child-agent restoration, and deletion.

Each sample removes its local and external transcript data during cleanup.

## Production considerations

These adapters are readable reference implementations, not production-ready
database packages. Before deployment:

- isolate tenants in the Redis prefix or PostgreSQL schema
- define retention, backup, encryption, and access control
- serialize concurrent writers for the same session
- account for a failed `append()` being retried with the same entries
- monitor `SDKMirrorErrorMessage`; the conversation can succeed even when an
  external write fails
- configure Redis eviction and TTL behavior for transcript retention
- size the PostgreSQL pool and schedule deletion of expired rows
- add backend-specific load, concurrency, failover, and cleanup tests

SessionStore contains transcript history only. It does not store credentials,
application settings, file checkpoints, or external tool side effects.
