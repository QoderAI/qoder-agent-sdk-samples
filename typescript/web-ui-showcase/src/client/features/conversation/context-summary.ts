export type ContextSummary = {
  label: string;
  title: string;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberAt(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function percentageLabel(value: number): string {
  const percentage = value >= 0 && value <= 1 ? value * 100 : value;
  return `${Math.round(Math.min(100, Math.max(0, percentage)))}%`;
}

function formatTokens(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

/** Summarizes old and current SDK Context responses for the Composer. */
export function readContextSummary(
  status: "loading" | "ready" | "unsupported" | undefined,
  context: Record<string, unknown> | undefined,
): ContextSummary | null {
  if (status !== "ready") return null;

  const contextWindow = record(context?.contextWindow);
  const percentage =
    numberAt(context, "percentage") ??
    numberAt(context, "percent") ??
    numberAt(context, "usedPercentage") ??
    numberAt(contextWindow, "usedPercentage");
  const usedTokens =
    numberAt(context, "totalTokens") ??
    numberAt(context, "usedTokens") ??
    numberAt(contextWindow, "usedTokens");
  const maxTokens =
    numberAt(context, "maxTokens") ??
    numberAt(context, "sizeTokens") ??
    numberAt(contextWindow, "sizeTokens");

  if (maxTokens === undefined || maxTokens <= 0 || percentage === undefined) {
    return null;
  }

  return {
    label: `Context ${percentageLabel(percentage)}`,
    title:
      usedTokens === undefined
        ? `当前 Session 的 Context 上限为 ${formatTokens(maxTokens)} tokens。`
        : `已使用 ${formatTokens(usedTokens)} / ${formatTokens(maxTokens)} tokens`,
  };
}
