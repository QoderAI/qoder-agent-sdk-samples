import argparse
import asyncio
import sys
from pathlib import Path

from qoder_agent_sdk import (
    AssistantMessage,
    QoderAgentOptions,
    QoderSDKClient,
    ResultMessage,
    StreamEvent,
    TextBlock,
    access_token_from_env,
)


async def read_prompt() -> str | None:
    value = (await asyncio.to_thread(input, "you> ")).strip()
    return value if value and value != "/exit" else None


async def receive_turn(client: QoderSDKClient) -> None:
    streamed_text = False
    completed = False
    async for message in client.receive_response():
        if isinstance(message, StreamEvent):
            delta = message.event.get("delta")
            if isinstance(delta, dict) and delta.get("type") == "text_delta":
                text = delta.get("text")
                if isinstance(text, str):
                    sys.stdout.write(text)
                    sys.stdout.flush()
                    streamed_text = True
        elif isinstance(message, AssistantMessage) and not streamed_text:
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text, end="", flush=True)
        elif isinstance(message, ResultMessage):
            if message.subtype != "success":
                raise RuntimeError("\n".join(message.errors or [message.subtype]))
            completed = True

    if not completed:
        raise RuntimeError("The turn ended without a success result.")
    print()


async def run(workspace: Path, scripted_prompts: list[str]) -> None:
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        tools=["Read", "Glob", "Grep"],
        allowed_tools=["Read", "Glob", "Grep"],
        include_partial_messages=True,
        max_turns=6,
    )
    async with QoderSDKClient(options=options) as client:
        if scripted_prompts:
            for prompt in scripted_prompts:
                await client.query(prompt)
                await receive_turn(client)
            return

        while True:
            interactive_prompt = await read_prompt()
            if interactive_prompt is None:
                break
            await client.query(interactive_prompt)
            await receive_turn(client)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("prompts", nargs="*")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    asyncio.run(run(args.workspace.resolve(), args.prompts))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, EOFError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
