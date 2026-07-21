import { pathToFileURL } from "node:url";
import * as readline from "node:readline/promises";

import {
  accessTokenFromEnv,
  query,
  type CanUseTool,
} from "@qoder-ai/qoder-agent-sdk";

type QuestionOption = {
  label: string;
  description?: string;
};

type Question = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
};

const DEFAULT_PROMPT = `Use AskUserQuestion exactly once before making a recommendation. Ask these two questions:
1. Header "Environment": "Which deployment environment should we use?" with options "Staging" and "Production"; single-select.
2. Header "Checks": "Which validation checks should run?" with options "Unit tests", "Integration tests", and "Security scan"; multi-select.
After receiving the answers, summarize the choices in one sentence. Do not use other tools.`;

const terminal = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let answeredQuestions = 0;

function parseQuestions(input: Record<string, unknown>): Question[] {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error("AskUserQuestion input must contain a non-empty questions array.");
  }

  return input.questions.map((rawQuestion, questionIndex) => {
    if (!rawQuestion || typeof rawQuestion !== "object") {
      throw new Error(`Question ${questionIndex + 1} must be an object.`);
    }
    const value = rawQuestion as Record<string, unknown>;
    if (typeof value.question !== "string" || !value.question.trim()) {
      throw new Error(`Question ${questionIndex + 1} has no question text.`);
    }
    if (!Array.isArray(value.options) || value.options.length < 2) {
      throw new Error(`Question ${questionIndex + 1} needs at least two options.`);
    }
    const options = value.options.map((rawOption, optionIndex) => {
      if (!rawOption || typeof rawOption !== "object") {
        throw new Error(
          `Option ${optionIndex + 1} in question ${questionIndex + 1} must be an object.`,
        );
      }
      const option = rawOption as Record<string, unknown>;
      if (typeof option.label !== "string" || !option.label.trim()) {
        throw new Error(
          `Option ${optionIndex + 1} in question ${questionIndex + 1} has no label.`,
        );
      }
      return {
        label: option.label,
        description:
          typeof option.description === "string"
            ? option.description
            : undefined,
      };
    });
    return {
      question: value.question,
      header:
        typeof value.header === "string" && value.header.trim()
          ? value.header
          : `Question ${questionIndex + 1}`,
      options,
      multiSelect: value.multiSelect === true,
    };
  });
}

async function readAnswer(question: Question): Promise<string> {
  console.log(`\n[${question.header}] ${question.question}`);
  question.options.forEach((option, index) => {
    const description = option.description ? ` — ${option.description}` : "";
    console.log(`  ${index + 1}. ${option.label}${description}`);
  });
  console.log(
    question.multiSelect
      ? "  Enter comma-separated numbers, or type a custom answer."
      : "  Enter one number, or type a custom answer.",
  );

  while (true) {
    const raw = (await terminal.question("  > ")).trim();
    if (!raw) return question.options[0].label;

    const parts = raw.split(",").map((part) => part.trim());
    const numeric = parts.every((part) => /^\d+$/.test(part));
    if (numeric) {
      const indices = parts.map((part) => Number(part) - 1);
      const valid = indices.every(
        (index) => index >= 0 && index < question.options.length,
      );
      if (!valid || (!question.multiSelect && indices.length !== 1)) {
        console.log("  Invalid selection; try again.");
        continue;
      }
      return indices.map((index) => question.options[index].label).join(", ");
    }

    const matches = question.options.filter((option) =>
      option.label.toLowerCase().startsWith(raw.toLowerCase()),
    );
    return matches.length === 1 ? matches[0].label : raw;
  }
}

export const respondToAskUserQuestion: CanUseTool = async (
  toolName,
  input,
) => {
  if (toolName !== "AskUserQuestion" && toolName !== "ask_user") {
    return {
      behavior: "deny",
      message: `This sample handles only AskUserQuestion, not ${toolName}.`,
    };
  }

  try {
    const questions = parseQuestions(input);
    const answers: Record<string, string> = {};
    for (const question of questions) {
      answers[question.question] = await readAnswer(question);
      answeredQuestions += 1;
    }
    return {
      behavior: "allow",
      updatedInput: { ...input, answers },
    };
  } catch (error) {
    return {
      behavior: "deny",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export async function run(prompt: string): Promise<void> {
  answeredQuestions = 0;
  const stream = query({
    prompt,
    options: {
      auth: accessTokenFromEnv(),
      model: "auto",
      tools: ["AskUserQuestion"],
      permissionMode: "default",
      canUseTool: respondToAskUserQuestion,
      maxTurns: 3,
    },
  });

  let completed = false;
  try {
    for await (const message of stream) {
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new Error(message.errors?.join("\n") || message.subtype);
        }
        console.log(`\nassistant> ${message.result}`);
        completed = true;
      }
    }
  } finally {
    await stream.close();
    terminal.close();
  }

  if (!completed) throw new Error("The query ended without a success result.");
  if (answeredQuestions === 0) {
    throw new Error("The agent completed without calling AskUserQuestion.");
  }
  console.log(`\nAnswered ${answeredQuestions} question(s).`);
}

async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ") || DEFAULT_PROMPT;
  await run(prompt);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
