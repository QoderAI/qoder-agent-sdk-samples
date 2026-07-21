import argparse
import asyncio
from pathlib import Path

from qoder_agent_sdk import (
    AssistantMessage,
    QoderAgentOptions,
    ResultMessage,
    TextBlock,
    access_token_from_env,
    query,
)


async def run(workspace: Path, prompt: str) -> None:
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        tools=["Read", "Glob", "Grep"],
        allowed_tools=["Read", "Glob", "Grep"],
        max_turns=4,
    )
    completed = False
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, TextBlock):
                    print(block.text, end="", flush=True)
        elif isinstance(message, ResultMessage):
            if message.subtype != "success":
                raise RuntimeError("\n".join(message.errors or [message.subtype]))
            completed = True

    if not completed:
        raise RuntimeError("The query ended without a success result.")
    print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument(
        "prompt",
        nargs="*",
        default=[],
        help="Optional custom prompt",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prompt = " ".join(args.prompt) or (
        "Explain the purpose of this repository and identify its most important files."
    )
    asyncio.run(run(args.workspace.resolve(), prompt))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error)) from error
