import argparse
import asyncio
from pathlib import Path

from qoder_agent_sdk import (
    AgentDefinition,
    AssistantMessage,
    QoderAgentOptions,
    ResultMessage,
    TextBlock,
    access_token_from_env,
    query,
)

AGENTS = {
    "architecture-explorer": AgentDefinition(
        description="Maps the repository architecture and important boundaries.",
        prompt=(
            "Inspect the repository with read-only tools. Report the main modules, "
            "their responsibilities, dependencies, and architectural risks. Do not "
            "modify files."
        ),
        tools=["Read", "Glob", "Grep"],
        maxTurns=5,
    ),
    "test-strategist": AgentDefinition(
        description="Evaluates the test strategy for a proposed migration.",
        prompt=(
            "Inspect tests and production code with read-only tools. Identify "
            "critical behaviors, coverage gaps, and a practical migration "
            "verification plan. Do not modify files."
        ),
        tools=["Read", "Glob", "Grep"],
        maxTurns=5,
    ),
}


async def run(workspace: Path) -> None:
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        cwd=workspace,
        model="auto",
        agents=AGENTS,
        tools=["Agent"],
        allowed_tools=["Agent"],
        max_turns=8,
    )
    prompt = (
        "Ask architecture-explorer to map the repository, then ask test-strategist "
        "to design verification for a major dependency upgrade. Synthesize their "
        "findings into a concise migration plan with ordered steps and risks."
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
