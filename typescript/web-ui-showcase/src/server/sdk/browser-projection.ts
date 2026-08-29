import { redactForBrowser } from "./redact.js";

/** Projects an SDK value into a redacted browser-safe record. */
export function projectBrowserRecord(value: unknown): Record<string, unknown> {
  const safe = redactForBrowser(value);
  return typeof safe === "object" && safe !== null && !Array.isArray(safe)
    ? Object.fromEntries(Object.entries(safe))
    : { value: safe };
}

/** Projects SDK values into redacted browser-safe records. */
export function projectBrowserRecords(
  values: readonly unknown[],
): Record<string, unknown>[] {
  return values.map(projectBrowserRecord);
}
