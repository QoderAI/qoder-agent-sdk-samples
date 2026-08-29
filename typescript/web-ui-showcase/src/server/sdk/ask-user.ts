import { z } from "zod";
import { AppError } from "../errors/app-error.js";

const questionOptionSchema = z
  .object({
    label: z.string().trim().min(1),
    description: z.string().trim().min(1).optional(),
  })
  .strict();

const questionSchema = z
  .object({
    header: z.string().trim().min(1),
    question: z.string().trim().min(1),
    options: z.array(questionOptionSchema).min(2),
    multiSelect: z.boolean(),
  })
  .strict();

const askUserInputSchema = z
  .object({
    questions: z.array(questionSchema).min(1),
  })
  .passthrough();

export type ParsedQuestion = z.infer<typeof questionSchema>;

export function parseAskUserQuestions(
  input: Record<string, unknown>,
): ParsedQuestion[] {
  const parsed = askUserInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      {
        code: "ASK_USER_INPUT_INVALID",
        message: "AskUserQuestion provided an invalid question form.",
        status: 400,
        retryable: false,
      },
      { cause: parsed.error },
    );
  }
  return parsed.data.questions;
}

export function applyQuestionAnswers(
  input: Record<string, unknown>,
  answers: Record<string, string>,
): Record<string, unknown> {
  return { ...input, answers: { ...answers } };
}
