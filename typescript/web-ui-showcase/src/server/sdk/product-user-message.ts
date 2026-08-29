const interruptedReceipt = /^\[Request interrupted by user\]$/u;
const activeGoalReceipt =
  /^Goal still active\s+[–-]\s+model has not called update_goal\(status="complete"\)$/u;
const commandReceipt =
  /^<command-message>[^<\r\n]*<\/command-message>\s*<command-name>\/[^<\r\n]+<\/command-name>$/u;
const localCommandOutputReceipt =
  /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/u;
const taskNotificationReceipt =
  /^<task-notification>\s*<task-id>[^<\r\n]+<\/task-id>\s*<tool-use-id>[^<\r\n]+<\/tool-use-id>\s*<output-file>[^<\r\n]+<\/output-file>\s*<status>[^<\r\n]+<\/status>\s*<summary>[^<]*<\/summary>\s*<\/task-notification>$/u;

/** Returns whether user-shaped SDK text belongs in the product transcript. */
export function isProductUserText(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length === 0) return false;
  return !interruptedReceipt.test(normalized) &&
    !activeGoalReceipt.test(normalized) &&
    !commandReceipt.test(normalized) &&
    !localCommandOutputReceipt.test(normalized) &&
    !taskNotificationReceipt.test(normalized);
}
