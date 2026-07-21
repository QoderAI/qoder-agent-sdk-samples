import argparse
import asyncio
import re
import subprocess
from pathlib import Path

from qoder_agent_sdk import (
    AssistantMessage,
    QoderAgentOptions,
    ResultMessage,
    TextBlock,
    access_token_from_env,
    query,
)

MAX_DIFF_BYTES = 100_000
GIT_REF_PATTERN = re.compile(r"^[A-Za-z0-9._/@{}^~:+-]+$")


def validate_git_ref(ref: str) -> str:
    if ref.startswith("-") or not GIT_REF_PATTERN.fullmatch(ref):
        raise ValueError(f"Invalid Git revision: {ref}")
    return ref


def read_diff(workspace: Path, base: str | None, head: str) -> str:
    revisions = (
        [f"{validate_git_ref(base)}...{validate_git_ref(head)}"]
        if base
        else [validate_git_ref(head)]
    )
    result = subprocess.run(
        [
            "git",
            "diff",
            "--no-ext-diff",
            "--unified=40",
            *revisions,
            "--",
        ],
        cwd=workspace,
        check=True,
        capture_output=True,
        text=True,
    )
    diff = result.stdout
    if not diff.strip():
        if base:
            raise RuntimeError(f"No changes found between {base} and {head}.")
        raise RuntimeError(f"No working-tree changes found relative to {head}.")
    if len(diff.encode()) > MAX_DIFF_BYTES:
        raise RuntimeError("The diff is larger than 100 KB; review a smaller change.")
    return diff


async def review(workspace: Path, diff: str) -> None:
    prompt = (
        "Review the following Git diff. Use the repository only to understand "
        "surrounding code. Report only concrete correctness, security, reliability, "
        "or maintainability problems introduced by the change. For each finding "
        "include severity, file, location, explanation, and a specific fix. If there "
        "are no findings, say so.\n\n<git_diff>\n"
        f"{diff}\n</git_diff>"
    )
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        tools=["Read", "Glob", "Grep"],
        allowed_tools=["Read", "Glob", "Grep"],
        max_turns=6,
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
        raise RuntimeError("The review ended without a success result.")
    print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--base")
    parser.add_argument("--head", default="HEAD")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    workspace = args.workspace.resolve()
    asyncio.run(review(workspace, read_diff(workspace, args.base, args.head)))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
