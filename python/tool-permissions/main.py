import argparse
import asyncio
from pathlib import Path
from typing import Any

from qoder_agent_sdk import (
    AssistantMessage,
    PermissionResultAllow,
    PermissionResultDeny,
    QoderAgentOptions,
    ResultMessage,
    TextBlock,
    ToolPermissionContext,
    access_token_from_env,
    query,
)

ALLOWED_COMMANDS = {
    "git status --short",
    "git status --porcelain",
    "git --no-pager status --short",
    "git --no-pager status --porcelain",
}


async def authorize_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    context: ToolPermissionContext,
) -> PermissionResultAllow | PermissionResultDeny:
    del context
    if tool_name != "Bash":
        return PermissionResultDeny(message=f"Tool {tool_name} is not permitted.")

    raw_command = tool_input.get("command")
    command = raw_command.strip() if isinstance(raw_command, str) else ""
    if command not in ALLOWED_COMMANDS:
        print(f"[permission] denied Bash: {command or '<missing command>'}")
        return PermissionResultDeny(
            message="Only a read-only git status command is permitted."
        )

    print(f"[permission] allowed Bash: {command}")
    return PermissionResultAllow(updated_input=tool_input)


async def run(workspace: Path) -> None:
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        tools=["Read", "Glob", "Grep", "Bash"],
        allowed_tools=["Read", "Glob", "Grep"],
        permission_mode="default",
        can_use_tool=authorize_tool,
        max_turns=3,
    )
    completed = False
    async for message in query(
        prompt=(
            "Run exactly `git --no-pager status --short`, then explain the "
            "repository status in one sentence. Do not modify any files."
        ),
        options=options,
    ):
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", type=Path, default=Path.cwd())
    args = parser.parse_args()
    asyncio.run(run(args.workspace.resolve()))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error)) from error
