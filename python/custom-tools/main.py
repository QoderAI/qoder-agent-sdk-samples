import asyncio
import json
from pathlib import Path
from typing import Any, TypedDict, cast

from qoder_agent_sdk import (
    AssistantMessage,
    QoderAgentOptions,
    ResultMessage,
    TextBlock,
    access_token_from_env,
    create_sdk_mcp_server,
    query,
    tool,
)


class ServiceInput(TypedDict):
    service: str


def load_data() -> dict[str, Any]:
    path = Path(__file__).with_name("data.json")
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("data.json must contain a JSON object")
    return cast(dict[str, Any], data)


def get_service(service: str) -> dict[str, Any]:
    record = load_data()["services"].get(service)
    if not isinstance(record, dict):
        raise ValueError(f"Unknown service: {service}")
    return record


@tool(
    "get_build_status",
    "Return the latest CI build status for a service.",
    ServiceInput,
)
async def get_build_status(args: ServiceInput) -> dict[str, Any]:
    try:
        build = get_service(args["service"])["build"]
        return {"content": [{"type": "text", "text": json.dumps(build)}]}
    except ValueError as error:
        return {
            "is_error": True,
            "content": [{"type": "text", "text": str(error)}],
        }


@tool(
    "get_open_incidents",
    "Return open production incidents for a service.",
    ServiceInput,
)
async def get_open_incidents(args: ServiceInput) -> dict[str, Any]:
    try:
        incidents = get_service(args["service"])["incidents"]
        return {"content": [{"type": "text", "text": json.dumps(incidents)}]}
    except ValueError as error:
        return {
            "is_error": True,
            "content": [{"type": "text", "text": str(error)}],
        }


async def run(service: str) -> None:
    server_name = "release_readiness"
    server = create_sdk_mcp_server(
        name=server_name,
        version="1.0.0",
        tools=[get_build_status, get_open_incidents],
    )
    tool_names = [
        f"mcp__{server_name}__get_build_status",
        f"mcp__{server_name}__get_open_incidents",
    ]
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        model="auto",
        mcp_servers={server_name: server},
        tools=tool_names,
        allowed_tools=tool_names,
        max_turns=4,
    )
    prompt = (
        f"Use both available tools to assess whether {service} is ready to "
        "release. Cite the build revision and every open incident in a concise "
        "recommendation."
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
    import sys

    asyncio.run(run(sys.argv[1] if len(sys.argv) > 1 else "payments-api"))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError) as error:
        raise SystemExit(str(error)) from error
