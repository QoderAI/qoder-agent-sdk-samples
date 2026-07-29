"""Runnable Redis SessionStore reference sample."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import time
import uuid
from pathlib import Path
from typing import cast

from qoder_agent_sdk import (
    QoderAgentOptions,
    ResultMessage,
    SDKMirrorErrorMessage,
    SessionKey,
    SessionListSubkeysKey,
    SessionStore,
    SessionStoreEntry,
    SessionStoreListEntry,
    access_token_from_env,
    delete_session,
    delete_session_via_store,
    get_session_info,
    query,
)
from redis.asyncio import Redis

_MAIN_TRANSCRIPT = "main"


def _encoded(value: str) -> str:
    encoded = base64.urlsafe_b64encode(value.encode()).decode()
    return encoded.rstrip("=")


class RedisSessionStore(SessionStore):
    """Store transcript entries in Redis lists with lightweight indexes."""

    def __init__(
        self,
        client: Redis,
        prefix: str = "qoder:samples:session-storage",
    ) -> None:
        self._client = client
        self._prefix = prefix.rstrip(":")

    async def append(
        self,
        key: SessionKey,
        entries: list[SessionStoreEntry],
    ) -> None:
        if not entries:
            return

        transaction = self._client.pipeline(transaction=True)
        transaction.rpush(
            self._entries_key(key),
            *(json.dumps(entry, separators=(",", ":")) for entry in entries),
        )
        subpath = key.get("subpath")
        if subpath is None:
            transaction.zadd(
                self._sessions_key(key["project_key"]),
                {key["session_id"]: int(time.time() * 1000)},
            )
        else:
            transaction.sadd(self._subkeys_key(key), subpath)
        await transaction.execute()

    async def load(self, key: SessionKey) -> list[SessionStoreEntry] | None:
        values = cast(
            list[str],
            await self._client.lrange(self._entries_key(key), 0, -1),
        )
        if not values:
            return None
        return [cast(SessionStoreEntry, json.loads(value)) for value in values]

    async def list_sessions(
        self,
        project_key: str,
    ) -> list[SessionStoreListEntry]:
        values = cast(
            list[tuple[str, float]],
            await self._client.zrange(
                self._sessions_key(project_key),
                0,
                -1,
                desc=True,
                withscores=True,
            ),
        )
        return [
            {"session_id": session_id, "mtime": int(mtime)}
            for session_id, mtime in values
        ]

    async def list_subkeys(self, key: SessionListSubkeysKey) -> list[str]:
        values = cast(
            set[str],
            await self._client.smembers(self._subkeys_key(key)),
        )
        return sorted(values)

    async def delete(self, key: SessionKey) -> None:
        subpath = key.get("subpath")
        if subpath is not None:
            transaction = self._client.pipeline(transaction=True)
            transaction.delete(self._entries_key(key))
            transaction.srem(self._subkeys_key(key), subpath)
            await transaction.execute()
            return

        subpaths = cast(
            set[str],
            await self._client.smembers(self._subkeys_key(key)),
        )
        keys = [self._entries_key(key), self._subkeys_key(key)]
        keys.extend(
            self._entries_key({**key, "subpath": subpath}) for subpath in subpaths
        )
        transaction = self._client.pipeline(transaction=True)
        transaction.delete(*keys)
        transaction.zrem(
            self._sessions_key(key["project_key"]),
            key["session_id"],
        )
        await transaction.execute()

    def _entries_key(self, key: SessionKey) -> str:
        subpath = key.get("subpath")
        transcript = (
            f"child:{_encoded(subpath)}" if subpath is not None else _MAIN_TRANSCRIPT
        )
        return ":".join(
            [
                self._prefix,
                "entries",
                _encoded(key["project_key"]),
                _encoded(key["session_id"]),
                transcript,
            ]
        )

    def _sessions_key(self, project_key: str) -> str:
        return ":".join([self._prefix, "sessions", _encoded(project_key)])

    def _subkeys_key(self, key: SessionListSubkeysKey) -> str:
        return ":".join(
            [
                self._prefix,
                "subkeys",
                _encoded(key["project_key"]),
                _encoded(key["session_id"]),
            ]
        )


async def run_query(
    *,
    workspace: Path,
    prompt: str,
    store: SessionStore,
    resume: str | None = None,
) -> ResultMessage:
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        tools=[],
        max_turns=1,
        model="auto",
        session_store=store,
        resume=resume,
    )
    result: ResultMessage | None = None
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, SDKMirrorErrorMessage):
            raise RuntimeError(
                f"SessionStore could not persist {message.key}: {message.error}"
            )
        if isinstance(message, ResultMessage):
            if message.subtype != "success":
                raise RuntimeError("\n".join(message.errors or [message.subtype]))
            result = message

    if result is None:
        raise RuntimeError("The query ended without a success result.")
    return result


async def run(workspace: Path) -> None:
    client = Redis.from_url(
        os.getenv("QODER_SAMPLE_REDIS_URL", "redis://127.0.0.1:6379"),
        decode_responses=True,
    )
    store = RedisSessionStore(client)
    marker = f"session-storage-{uuid.uuid4()}"
    session_id: str | None = None

    try:
        print("[host-a] Starting a session with Redis storage.")
        first = await run_query(
            workspace=workspace,
            store=store,
            prompt=(
                f"Remember this exact deployment marker: {marker}. "
                "Reply only that it is stored."
            ),
        )
        session_id = first.session_id
        delete_session(session_id, str(workspace))
        print(f"[host-a] Stored session {session_id}; local transcript deleted.")

        print("[host-b] Starting without host A's local transcript.")
        resumed = await run_query(
            workspace=workspace,
            store=store,
            resume=session_id,
            prompt=(
                "What exact deployment marker did I ask you to remember? "
                "Reply only with the marker."
            ),
        )
        print(f"[host-b] Resumed session {resumed.session_id}.")
        print(f"[host-b] Agent response: {resumed.result}")

        if marker not in (resumed.result or ""):
            raise RuntimeError(
                "The resumed response did not contain the stored marker."
            )
        print("[app] External session handoff verified.")
    finally:
        try:
            if session_id:
                if get_session_info(session_id, str(workspace)) is not None:
                    delete_session(session_id, str(workspace))
                await delete_session_via_store(store, session_id, workspace)
                print("[app] Deleted sample transcript.")
        finally:
            await client.aclose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", type=Path, default=Path.cwd())
    workspace = cast(Path, parser.parse_args().workspace).resolve()
    asyncio.run(run(workspace))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
