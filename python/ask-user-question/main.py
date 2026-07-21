import argparse
import asyncio
from typing import Any, TypedDict

from qoder_agent_sdk import (
    PermissionResultAllow,
    PermissionResultDeny,
    QoderAgentOptions,
    ResultMessage,
    ToolPermissionContext,
    access_token_from_env,
    query,
)
from typing_extensions import NotRequired


class QuestionOption(TypedDict):
    label: str
    description: NotRequired[str]


class Question(TypedDict):
    question: str
    header: str
    options: list[QuestionOption]
    multiSelect: bool


DEFAULT_PROMPT = (
    "Use AskUserQuestion exactly once before making a recommendation. Ask these "
    "two questions:\n"
    '1. Header "Environment": "Which deployment environment should we use?" with '
    'options "Staging" and "Production"; single-select.\n'
    '2. Header "Checks": "Which validation checks should run?" with options "Unit '
    'tests", "Integration tests", and "Security scan"; multi-select.\n'
    "After receiving the answers, summarize the choices in one sentence. Do not "
    "use other tools."
)

answered_questions = 0


def parse_questions(input_data: dict[str, Any]) -> list[Question]:
    raw_questions = input_data.get("questions")
    if not isinstance(raw_questions, list) or not raw_questions:
        raise ValueError(
            "AskUserQuestion input must contain a non-empty questions array."
        )

    questions: list[Question] = []
    for question_index, raw_question in enumerate(raw_questions, start=1):
        if not isinstance(raw_question, dict):
            raise ValueError(f"Question {question_index} must be an object.")
        text = raw_question.get("question")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"Question {question_index} has no question text.")
        raw_options = raw_question.get("options")
        if not isinstance(raw_options, list) or len(raw_options) < 2:
            raise ValueError(f"Question {question_index} needs at least two options.")

        options: list[QuestionOption] = []
        for option_index, raw_option in enumerate(raw_options, start=1):
            if not isinstance(raw_option, dict):
                raise ValueError(
                    f"Option {option_index} in question {question_index} "
                    "must be an object."
                )
            label = raw_option.get("label")
            if not isinstance(label, str) or not label.strip():
                raise ValueError(
                    f"Option {option_index} in question {question_index} has no label."
                )
            option: QuestionOption = {"label": label}
            description = raw_option.get("description")
            if isinstance(description, str):
                option["description"] = description
            options.append(option)

        header = raw_question.get("header")
        questions.append(
            {
                "question": text,
                "header": (
                    header
                    if isinstance(header, str) and header.strip()
                    else f"Question {question_index}"
                ),
                "options": options,
                "multiSelect": raw_question.get("multiSelect") is True,
            }
        )
    return questions


async def async_input(prompt: str) -> str:
    return await asyncio.to_thread(input, prompt)


async def read_answer(question: Question) -> str:
    print(f"\n[{question['header']}] {question['question']}")
    for index, option in enumerate(question["options"], start=1):
        description = option.get("description")
        suffix = f" — {description}" if description else ""
        print(f"  {index}. {option['label']}{suffix}")
    if question["multiSelect"]:
        print("  Enter comma-separated numbers, or type a custom answer.")
    else:
        print("  Enter one number, or type a custom answer.")

    while True:
        raw = (await async_input("  > ")).strip()
        if not raw:
            return question["options"][0]["label"]

        parts = [part.strip() for part in raw.split(",")]
        if all(part.isdigit() for part in parts):
            indices = [int(part) - 1 for part in parts]
            valid = all(0 <= index < len(question["options"]) for index in indices)
            if not valid or (not question["multiSelect"] and len(indices) != 1):
                print("  Invalid selection; try again.")
                continue
            return ", ".join(question["options"][index]["label"] for index in indices)

        matches = [
            option["label"]
            for option in question["options"]
            if option["label"].lower().startswith(raw.lower())
        ]
        return matches[0] if len(matches) == 1 else raw


async def respond_to_ask_user_question(
    tool_name: str,
    input_data: dict[str, Any],
    _context: ToolPermissionContext,
) -> PermissionResultAllow | PermissionResultDeny:
    global answered_questions
    if tool_name not in {"AskUserQuestion", "ask_user"}:
        return PermissionResultDeny(
            message=f"This sample handles only AskUserQuestion, not {tool_name}."
        )

    try:
        questions = parse_questions(input_data)
        answers: dict[str, str] = {}
        for question in questions:
            answers[question["question"]] = await read_answer(question)
            answered_questions += 1
        return PermissionResultAllow(updated_input={**input_data, "answers": answers})
    except ValueError as error:
        return PermissionResultDeny(message=str(error))


async def run(prompt: str) -> None:
    global answered_questions
    answered_questions = 0
    options = QoderAgentOptions(
        auth=access_token_from_env(),
        model="auto",
        tools=["AskUserQuestion"],
        permission_mode="default",
        can_use_tool=respond_to_ask_user_question,
        max_turns=3,
    )

    completed = False
    async for message in query(prompt=prompt, options=options):
        if isinstance(message, ResultMessage):
            if message.subtype != "success":
                raise RuntimeError("\n".join(message.errors or [message.subtype]))
            print(f"\nassistant> {message.result or ''}")
            completed = True

    if not completed:
        raise RuntimeError("The query ended without a success result.")
    if answered_questions == 0:
        raise RuntimeError("The agent completed without calling AskUserQuestion.")
    print(f"\nAnswered {answered_questions} question(s).")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt", nargs="*")
    args = parser.parse_args()
    prompt = " ".join(args.prompt) or DEFAULT_PROMPT
    asyncio.run(run(prompt))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, EOFError, KeyboardInterrupt) as error:
        raise SystemExit(str(error)) from error
