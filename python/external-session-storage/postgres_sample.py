"""Runnable PostgreSQL SessionStore reference sample."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import uuid
from pathlib import Path
from typing import cast

import asyncpg
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

_SQL_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class PostgresSessionStore(SessionStore):
    """Store one transcript entry per PostgreSQL JSONB row."""

    def __init__(
        self,
        pool: asyncpg.Pool,
        table_name: str = "qoder_session_entries",
    ) -> None:
        if not _SQL_IDENTIFIER.fullmatch(table_name):
            raise ValueError(
                f"Invalid table name {table_name!r}. "
                "Use letters, digits, and underscores."
            )
        self._pool = pool
        self._table_name = table_name

    async def ensure_schema(self) -> None:
        """Create the entry table and lookup index when absent."""

        await self._pool.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._table_name} (
              seq BIGSERIAL PRIMARY KEY,
              project_key TEXT NOT NULL,
              session_id TEXT NOT NULL,
              subpath TEXT NOT NULL DEFAULT '',
              entry JSONB NOT NULL,
              modified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
            );
            CREATE INDEX IF NOT EXISTS {self._table_name}_lookup_idx
              ON {self._table_name}
              (project_key, session_id, subpath, seq);
            """
        )

    async def append(
        self,
        key: SessionKey,
        entries: list[SessionStoreEntry],
    ) -> None:
        if not entries:
            return

        await self._pool.execute(
            f"""
            INSERT INTO {self._table_name}
              (project_key, session_id, subpath, entry)
            SELECT $1, $2, $3, value
            FROM unnest($4::jsonb[]) WITH ORDINALITY AS item(value, position)
            ORDER BY position
            """,
            key["project_key"],
            key["session_id"],
            key.get("subpath", ""),
            [json.dumps(entry, separators=(",", ":")) for entry in entries],
        )

    async def load(self, key: SessionKey) -> list[SessionStoreEntry] | None:
        rows = await self._pool.fetch(
            f"""
            SELECT entry
            FROM {self._table_name}
            WHERE project_key = $1
              AND session_id = $2
              AND subpath = $3
            ORDER BY seq
            """,
            key["project_key"],
            key["session_id"],
            key.get("subpath", ""),
        )
        if not rows:
            return None
        entries: list[SessionStoreEntry] = []
        for row in rows:
            value = row["entry"]
            decoded = json.loads(value) if isinstance(value, str) else value
            entries.append(cast(SessionStoreEntry, decoded))
        return entries

    async def list_sessions(
        self,
        project_key: str,
    ) -> list[SessionStoreListEntry]:
        rows = await self._pool.fetch(
            f"""
            SELECT session_id,
                   EXTRACT(EPOCH FROM MAX(modified_at)) * 1000 AS mtime
            FROM {self._table_name}
            WHERE project_key = $1 AND subpath = ''
            GROUP BY session_id
            ORDER BY mtime DESC
            """,
            project_key,
        )
        return [
            {
                "session_id": cast(str, row["session_id"]),
                "mtime": int(row["mtime"]),
            }
            for row in rows
        ]

    async def list_subkeys(self, key: SessionListSubkeysKey) -> list[str]:
        rows = await self._pool.fetch(
            f"""
            SELECT DISTINCT subpath
            FROM {self._table_name}
            WHERE project_key = $1
              AND session_id = $2
              AND subpath <> ''
            ORDER BY subpath
            """,
            key["project_key"],
            key["session_id"],
        )
        return [cast(str, row["subpath"]) for row in rows]

    async def delete(self, key: SessionKey) -> None:
        subpath = key.get("subpath")
        if subpath is None:
            await self._pool.execute(
                f"""
                DELETE FROM {self._table_name}
                WHERE project_key = $1 AND session_id = $2
                """,
                key["project_key"],
                key["session_id"],
            )
            return

        await self._pool.execute(
            f"""
            DELETE FROM {self._table_name}
            WHERE project_key = $1
              AND session_id = $2
              AND subpath = $3
            """,
            key["project_key"],
            key["session_id"],
            subpath,
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
    pool = await asyncpg.create_pool(
        os.getenv(
            "QODER_SAMPLE_POSTGRES_URL",
            "postgresql://qoder:qoder@127.0.0.1:5432/qoder_session_store",
        )
    )
    if pool is None:
        raise RuntimeError("Could not create the PostgreSQL connection pool.")
    store = PostgresSessionStore(pool)
    marker = f"session-storage-{uuid.uuid4()}"
    session_id: str | None = None

    try:
        await store.ensure_schema()
        print("[host-a] Starting a session with PostgreSQL storage.")
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
            await pool.close()


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
