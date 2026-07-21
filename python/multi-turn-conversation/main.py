import argparse
import asyncio
import signal
import sys
from pathlib import Path
from types import FrameType

from qoder_agent_sdk import (
    AssistantMessage,
    QoderAgentOptions,
    QoderSDKClient,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    access_token_from_env,
)


class ConversationApp:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace
        self.client: QoderSDKClient | None = None
        self.response_task: asyncio.Task[None] | None = None
        self.session_id: str | None = None
        self.turn_active = False
        self.streamed_text = False
        self.interrupt_requested = False

    async def open(self, *, resume: bool) -> None:
        if self.client is not None:
            print("[app] A query is already open. Use /close first.")
            return
        if resume and self.session_id is None:
            print("[app] No previous session is available to resume.")
            return

        state = f"resume {self.session_id}" if resume else "new session"
        print(f"[lifecycle] opening query ({state})")
        options = QoderAgentOptions(
            auth=access_token_from_env(),
            cwd=self.workspace,
            model="auto",
            tools=["Read", "Glob", "Grep"],
            allowed_tools=["Read", "Glob", "Grep"],
            include_partial_messages=True,
            max_turns=8,
            resume=self.session_id if resume else None,
        )
        client = QoderSDKClient(options=options)
        await client.connect()
        self.client = client
        print("[lifecycle] query connected; session ID arrives with the first turn")

    async def send(self, prompt: str) -> None:
        if self.client is None:
            print("[app] The query is closed. Use /resume to continue.")
            return
        if self.turn_active:
            print("[app] A response is active. Wait or press Ctrl+C.")
            return

        self.turn_active = True
        self.streamed_text = False
        self.interrupt_requested = False
        print("[state] generating; press Ctrl+C to interrupt this turn")
        await self.client.query(prompt)
        self.response_task = asyncio.create_task(self._receive_turn(self.client))
        await self.response_task

    async def interrupt(self) -> None:
        if self.client is None or not self.turn_active or self.interrupt_requested:
            return
        self.interrupt_requested = True
        print("[lifecycle] interrupt requested")
        await self.client.interrupt()
        if self.response_task is not None:
            await self.response_task
        print("\n[lifecycle] runtime acknowledged the interrupt")

    async def close(self) -> None:
        client = self.client
        if client is None:
            print("[app] The query is already closed.")
            return

        print("[lifecycle] closing query")
        await client.disconnect()
        if self.response_task is not None:
            await self.response_task
        self.client = None
        self.response_task = None
        self.turn_active = False
        session = self.session_id or "not created"
        print(f"[lifecycle] query closed; session {session} can be resumed")

    def status(self) -> None:
        query_state = "open" if self.client is not None else "closed"
        turn_state = "generating" if self.turn_active else "idle"
        session = self.session_id or "pending"
        print(f"[status] query={query_state} turn={turn_state} session={session}")

    async def _receive_turn(self, client: QoderSDKClient) -> None:
        try:
            async for message in client.receive_response():
                if isinstance(message, SystemMessage) and message.subtype == "init":
                    session_id = message.data.get("session_id")
                    if isinstance(session_id, str):
                        self.session_id = session_id
                        print(f"[lifecycle] query ready; session={session_id}")
                    continue

                if isinstance(message, StreamEvent):
                    delta = message.event.get("delta")
                    if isinstance(delta, dict) and delta.get("type") == "text_delta":
                        text = delta.get("text")
                        if isinstance(text, str):
                            sys.stdout.write(text)
                            sys.stdout.flush()
                            self.streamed_text = True
                    continue

                if isinstance(message, AssistantMessage) and not self.streamed_text:
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            print(block.text, end="", flush=True)

                if isinstance(message, ResultMessage):
                    self.session_id = message.session_id
                    if message.subtype == "success":
                        print("\n[state] turn completed; query remains open")
                    elif self.interrupt_requested:
                        print("\n[state] turn interrupted; query remains open")
                    else:
                        errors = "; ".join(message.errors or [message.subtype])
                        print(f"\n[state] turn failed: {errors}")
        except Exception as error:
            if self.client is client:
                print(f"\n[app] query error: {error}")
        finally:
            self.turn_active = False


def print_help() -> None:
    print(
        """
Commands:
  /status     show query, turn, and session state
  /close      close the query and preserve its resumable session
  /resume     open a new query that resumes the preserved session
  /exit       close the query and exit
  /help       show this help

Any other input sends a new conversation turn. Press Ctrl+C while the agent is
generating to interrupt only that turn and keep the query open.
"""
    )


async def read_input() -> str:
    return (await asyncio.to_thread(input, "you> ")).strip()


async def send_with_interrupt(app: ConversationApp, prompt: str) -> None:
    loop = asyncio.get_running_loop()
    previous_handler = signal.getsignal(signal.SIGINT)

    def handle_interrupt(_signum: int, _frame: FrameType | None) -> None:
        loop.call_soon_threadsafe(lambda: asyncio.create_task(app.interrupt()))

    signal.signal(signal.SIGINT, handle_interrupt)
    try:
        await app.send(prompt)
    finally:
        signal.signal(signal.SIGINT, previous_handler)


async def run(workspace: Path) -> None:
    app = ConversationApp(workspace)
    await app.open(resume=False)
    print_help()

    try:
        while True:
            value = await read_input()
            if not value:
                continue
            if value == "/exit":
                break
            if value == "/help":
                print_help()
            elif value == "/status":
                app.status()
            elif value == "/close":
                await app.close()
            elif value == "/resume":
                await app.open(resume=True)
            else:
                await send_with_interrupt(app, value)
    finally:
        await app.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", type=Path, default=Path.cwd())
    args = parser.parse_args()
    asyncio.run(run(args.workspace.resolve()))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, EOFError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
