import { describe, expect, it } from "vitest";
import {
  applyQuestionAnswers,
  parseAskUserQuestions,
} from "../../../../src/server/sdk/ask-user.js";

const input = {
  questions: [
    {
      header: "Environment",
      question: "Which environment?",
      options: [
        { label: "Staging", description: "Validate first" },
        { label: "Production", description: "Deploy now" },
      ],
      multiSelect: false,
    },
    {
      header: "Checks",
      question: "Which checks?",
      options: [{ label: "Tests" }, { label: "Lint" }],
      multiSelect: true,
    },
  ],
};

describe("AskUserQuestion input", () => {
  it("parses single-select and multi-select questions", () => {
    expect(parseAskUserQuestions(input)).toEqual(input.questions);
  });

  it.each([
    { questions: [{ header: "Missing", options: [{ label: "A" }, { label: "B" }], multiSelect: false }] },
    { questions: [{ header: "Few", question: "Pick", options: [{ label: "A" }], multiSelect: false }] },
    { questions: [{ header: "Label", question: "Pick", options: [{ label: "A" }, {}], multiSelect: false }] },
  ])("rejects malformed question structures", (candidate) => {
    expect(() => parseAskUserQuestions(candidate)).toThrow(
      expect.objectContaining({ code: "ASK_USER_INPUT_INVALID" }),
    );
  });

  it("adds answers without changing the original tool input", () => {
    const answers = {
      "Which environment?": "Staging",
      "Which checks?": "Tests, Lint",
    };

    expect(applyQuestionAnswers(input, answers)).toEqual({ ...input, answers });
    expect(input).not.toHaveProperty("answers");
  });
});
