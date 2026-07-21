import argparse
import asyncio
from pathlib import Path
from typing import Any

from qoder_agent_sdk import (
    AssistantMessage,
    HookContext,
    HookInput,
    HookJSONOutput,
    HookMatcher,
    QoderAgentOptions,
    QoderSDKClient,
    ResultMessage,
    TextBlock,
    access_token_from_env,
)

SAFE_STATUS_COMMANDS = {
    "git status --short",
    "git status --porcelain",
    "git --no-pager status --short",
    "git --no-pager status --porcelain",
}

DEFAULT_PROMPT = (
    "Run exactly `git --no-pager status --short`, read README.md, then explain "
    "in two sentences what this repository contains and whether it has "
    "uncommitted changes."
)

event_counts: dict[str, int] = {}


def record(event: str, detail: str) -> None:
    event_counts[event] = event_counts.get(event, 0) + 1
    print(f"[hook:{event}] {detail}")


async def on_session_start(
    input_data: HookInput, _tool_use_id: str | None, _context: HookContext
) -> HookJSONOutput:
    if input_data["hook_event_name"] != "SessionStart":
        return {}
    record("SessionStart", f"source={input_data['source']}")
    return {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": (
                "This application is running a read-only repository inspection session."
            ),
        }
    }


async def on_prompt_submit(
    input_data: HookInput, _tool_use_id: str | None, _context: HookContext
) -> HookJSONOutput:
    if input_data["hook_event_name"] != "UserPromptSubmit":
        return {}
    record("UserPromptSubmit", f"received {len(input_data['prompt'])} characters")
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": (
                "Report only observed repository facts and do not propose file changes."
            ),
        }
    }


async def before_bash(
    input_data: HookInput, _tool_use_id: str | None, _context: HookContext
) -> HookJSONOutput:
    if (
        input_data["hook_event_name"] != "PreToolUse"
        or input_data["tool_name"] != "Bash"
    ):
        return {}
    raw_command: Any = input_data["tool_input"].get("command")
    command = raw_command.strip() if isinstance(raw_command, str) else ""
    if command not in SAFE_STATUS_COMMANDS:
        record("PreToolUse", f"denied Bash: {command or '<missing command>'}")
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": (
                    "This sample permits only a read-only git status command."
                ),
            }
        }
    record("PreToolUse", f"allowed Bash: {command}")
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": ("The command matches the read-only policy."),
        }
    }


async def after_tool(
    input_data: HookInput, _tool_use_id: str | None, _context: HookContext
) -> HookJSONOutput:
    if input_data["hook_event_name"] != "PostToolUse":
        return {}
    record("PostToolUse", f"completed {input_data['tool_name']}")
    if input_data["tool_name"] != "Bash":
        return {}
    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": (
                "The host application audited the git status command successfully."
            ),
        }
    }


async def on_stop(
    input_data: HookInput, _tool_use_id: str | None, _context: HookContext
) -> HookJSONOutput:
    if input_data["hook_event_name"] != "Stop":
        return {}
    record("Stop", "assistant finished generating")
    return {}


async def run(workspace: Path, prompt: str) -> None:
    event_counts.clear()
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        tools=["Read", "Bash"],
        allowed_tools=["Read", "Bash"],
        max_turns=4,
        hooks={
            "SessionStart": [HookMatcher(hooks=[on_session_start])],
            "UserPromptSubmit": [HookMatcher(hooks=[on_prompt_submit])],
            "PreToolUse": [HookMatcher(matcher="Bash", hooks=[before_bash])],
            "PostToolUse": [HookMatcher(hooks=[after_tool])],
            "Stop": [HookMatcher(hooks=[on_stop])],
        },
    )

    completed = False
    async with QoderSDKClient(options=options) as client:
        await client.query(prompt)
        async for message in client.receive_response():
            if isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        print(block.text, flush=True)
            elif isinstance(message, ResultMessage):
                if message.subtype != "success":
                    raise RuntimeError("\n".join(message.errors or [message.subtype]))
                completed = True
    if not completed:
        raise RuntimeError("The query ended without a success result.")

    print("\n\nHook summary:")
    for event, count in event_counts.items():
        print(f"- {event}: {count}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument("prompt", nargs="*")
    args = parser.parse_args()
    prompt = " ".join(args.prompt) or DEFAULT_PROMPT
    asyncio.run(run(args.workspace.resolve(), prompt))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
