import { describe, expect, it } from "vitest";
import { readContextSummary } from "../../../src/client/features/conversation/context-summary.js";

describe("readContextSummary", () => {
  it("omits Context until the SDK reports usable capacity and percentage", () => {
    expect(readContextSummary("loading", undefined)).toBeNull();
    expect(readContextSummary("unsupported", undefined)).toBeNull();
    expect(readContextSummary("ready", { model: "fixture-model" })).toBeNull();
  });

  it("reads the installed SDK Context response", () => {
    expect(
      readContextSummary("ready", {
        percentage: 0.39,
        totalTokens: 390,
        maxTokens: 1_000,
      }),
    ).toEqual({
      label: "Context 39%",
      title: "已使用 390 / 1,000 tokens",
    });
  });

  it("reads the nested Context response and clamps percentages", () => {
    expect(
      readContextSummary("ready", {
        contextWindow: {
          usedPercentage: 142,
          usedTokens: 1_420,
          sizeTokens: 1_000,
        },
      }),
    ).toEqual({
      label: "Context 100%",
      title: "已使用 1,420 / 1,000 tokens",
    });
  });

  it("omits Context when the SDK reports no token capacity", () => {
    expect(
      readContextSummary("ready", {
        percentage: 0,
        totalTokens: 0,
        maxTokens: 0,
      }),
    ).toBeNull();
  });
});
