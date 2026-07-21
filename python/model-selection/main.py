import argparse
import asyncio
from typing import Any, cast

from qoder_agent_sdk import (
    ModelPolicyContext,
    ModelPolicyResult,
    QoderAgentOptions,
    QoderSDKClient,
    ResultMessage,
    access_token_from_env,
)


class Selection:
    def __init__(
        self,
        model: dict[str, Any],
        context_window: int | None,
        reasoning_effort: str | None,
    ) -> None:
        self.model = model
        self.context_window = context_window
        self.reasoning_effort = reasoning_effort


def context_windows(model: dict[str, Any]) -> list[int]:
    windows: list[int] = []
    direct = model.get("availableContextWindows")
    if isinstance(direct, list):
        windows.extend(value for value in direct if isinstance(value, int))
    configured = model.get("context_config")
    if isinstance(configured, dict):
        for raw_entry in configured.values():
            if isinstance(raw_entry, dict):
                token_count = raw_entry.get("token_count")
                if isinstance(token_count, int):
                    windows.append(token_count)
    return sorted(set(windows))


def default_context_window(model: dict[str, Any]) -> int | None:
    direct = model.get("defaultContextWindow")
    if isinstance(direct, int):
        return direct
    configured = model.get("context_config")
    if isinstance(configured, dict):
        for raw_entry in configured.values():
            if isinstance(raw_entry, dict) and raw_entry.get("is_default") is True:
                token_count = raw_entry.get("token_count")
                if isinstance(token_count, int):
                    return token_count
    return None


def reasoning_efforts(model: dict[str, Any]) -> list[str]:
    efforts: list[str] = []
    direct = model.get("efforts")
    if isinstance(direct, list):
        efforts.extend(value for value in direct if isinstance(value, str))
    thinking = model.get("thinking_config")
    if isinstance(thinking, dict):
        enabled = thinking.get("enabled")
        if isinstance(enabled, dict):
            configured = enabled.get("efforts")
            if isinstance(configured, dict):
                efforts.extend(str(value) for value in configured)
    return list(dict.fromkeys(efforts))


def default_reasoning_effort(model: dict[str, Any]) -> str | None:
    direct = model.get("defaultEffort")
    if isinstance(direct, str):
        return direct
    thinking = model.get("thinking_config")
    if not isinstance(thinking, dict):
        return None
    enabled = thinking.get("enabled")
    if not isinstance(enabled, dict):
        return None
    configured = enabled.get("efforts")
    if not isinstance(configured, dict):
        return None
    for name, raw_entry in configured.items():
        if isinstance(raw_entry, dict) and raw_entry.get("is_default") is True:
            return str(name)
    return None


def describe_model(model: dict[str, Any]) -> str:
    value = str(model.get("value", "<unknown>"))
    name = str(model.get("displayName") or value)
    windows = context_windows(model)
    efforts = reasoning_efforts(model)
    context = "/".join(f"{window:,}" for window in windows) or "default"
    reasoning = "/".join(efforts) or "default"
    return f"{name} ({value}) — context={context}, reasoning={reasoning}"


async def async_input(prompt: str) -> str:
    return await asyncio.to_thread(input, prompt)


async def choose_index(label: str, values: list[str], default_index: int) -> int:
    while True:
        raw = (await async_input(f"{label} [{default_index + 1}]: ")).strip()
        if not raw:
            return default_index
        if raw.isdigit():
            index = int(raw) - 1
            if 0 <= index < len(values):
                return index
        lowered = raw.lower()
        for index, value in enumerate(values):
            if value.lower() == lowered:
                return index
        print("Invalid selection; enter a listed number or value.")


async def choose_model(models: list[dict[str, Any]]) -> Selection:
    enabled = [model for model in models if model.get("isEnabled") is not False]
    if not enabled:
        raise RuntimeError("No enabled models are available.")

    print("Available models:\n")
    for index, model in enumerate(enabled, start=1):
        marker = " [default]" if model.get("isDefault") is True else ""
        print(f"{index}. {describe_model(model)}{marker}")

    default_index = next(
        (
            index
            for index, model in enumerate(enabled)
            if model.get("isDefault") is True or model.get("value") == "auto"
        ),
        0,
    )
    model_index = await choose_index(
        "Choose model",
        [str(model.get("value", "")) for model in enabled],
        default_index,
    )
    model = enabled[model_index]

    windows = context_windows(model)
    context_window: int | None = None
    if windows:
        rendered = "  ".join(
            f"{index}. {window:,}" for index, window in enumerate(windows, start=1)
        )
        print(f"\nContext windows: {rendered}")
        context_default = default_context_window(model)
        window_default = (
            windows.index(context_default) if context_default in windows else 0
        )
        selected = await choose_index(
            "Choose context window", [str(window) for window in windows], window_default
        )
        context_window = windows[selected]

    efforts = reasoning_efforts(model)
    reasoning_effort: str | None = None
    if efforts:
        rendered = "  ".join(
            f"{index}. {effort}" for index, effort in enumerate(efforts, start=1)
        )
        print(f"\nReasoning efforts: {rendered}")
        effort_default_value = default_reasoning_effort(model)
        effort_default = (
            efforts.index(effort_default_value)
            if effort_default_value in efforts
            else 0
        )
        selected = await choose_index(
            "Choose reasoning effort", efforts, effort_default
        )
        reasoning_effort = efforts[selected]

    return Selection(model, context_window, reasoning_effort)


async def load_models() -> list[dict[str, Any]]:
    options = QoderAgentOptions(auth=access_token_from_env(), model="auto")
    async with QoderSDKClient(options=options) as client:
        models = await client.get_available_models()
    return [cast(dict[str, Any], model) for model in models]


def policy_result(selection: Selection) -> ModelPolicyResult:
    parameters: dict[str, Any] = {}
    if selection.context_window is not None:
        parameters["contextWindow"] = selection.context_window
    if selection.reasoning_effort is not None:
        parameters["reasoningEffort"] = selection.reasoning_effort
    result: ModelPolicyResult = {"model": str(selection.model["value"])}
    if parameters:
        result["parameters"] = parameters
    return result


async def run(prompt: str) -> None:
    models = await load_models()
    if not models:
        raise RuntimeError("The model catalog is temporarily empty.")
    selection = await choose_model(models)
    selected_policy = policy_result(selection)
    model_value = str(selection.model["value"])

    print(f"\nSelected model: {model_value}")
    context = (
        f"{selection.context_window:,}" if selection.context_window else "model default"
    )
    print(f"Context window: {context}")
    print(f"Reasoning effort: {selection.reasoning_effort or 'model default'}\n")

    def resolve_model(context_data: ModelPolicyContext) -> ModelPolicyResult:
        available = {
            model.get("value") for model in context_data.get("availableModels", [])
        }
        if available and model_value not in available:
            raise RuntimeError(f"Model {model_value} is no longer available.")
        purpose = context_data.get("purpose", "unknown")
        print(f"[model-policy] purpose={purpose} model={model_value}")
        return selected_policy

    options = QoderAgentOptions(
        auth=access_token_from_env(),
        resolve_model=resolve_model,
        resolve_model_timeout_ms=1_000,
        tools=[],
        max_turns=1,
    )
    completed = False
    async with QoderSDKClient(options=options) as client:
        await client.query(prompt)
        async for message in client.receive_response():
            if not isinstance(message, ResultMessage):
                continue
            if message.subtype != "success":
                raise RuntimeError("\n".join(message.errors or [message.subtype]))
            print(f"\nassistant> {message.result or ''}")
            completed = True

    if not completed:
        raise RuntimeError("The query ended without a success result.")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt", nargs="*")
    args = parser.parse_args()
    prompt = " ".join(args.prompt) or (
        "Explain in one sentence why applications should select models from "
        "runtime metadata."
    )
    asyncio.run(run(prompt))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, EOFError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
