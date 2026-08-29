import { createHash } from "node:crypto";
import type { ConversationItem } from "../../shared/model.js";
import type { HistoricalMessage } from "../services/session-catalog-port.js";
import { redactForBrowser, safeRawPayload } from "./redact.js";
import { isProductUserText } from "./product-user-message.js";

const fallbackTimestamp = "1970-01-01T00:00:00.000Z";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentBlocks(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((block) => {
        const item = record(block);
        return item === undefined ? [] : [item];
      })
    : [];
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  const text = contentBlocks(value)
    .map((item) =>
      item.type === "text" && typeof item.text === "string"
        ? item.text
        : "",
    )
    .join("");
  return text.length === 0 ? undefined : text;
}

function stableToolItemId(messageId: string, blockIndex: number): string {
  return stableItemId(`${messageId}:tool:${blockIndex}`);
}

function stableAssistantItemId(messageId: string, blockIndex: number): string {
  return stableItemId(`${messageId}:assistant:${blockIndex}`);
}

function stableItemId(source: string): string {
  const bytes = createHash("sha256")
    .update(source)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function durationMs(
  startedAt: string | undefined,
  completedAt: string,
): number | undefined {
  if (startedAt === undefined) return undefined;
  const elapsed = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

function followsCompactBoundary(
  message: HistoricalMessage,
  previous: HistoricalMessage | undefined,
): boolean {
  return message.type === "user" &&
    previous?.type === "system" &&
    previous.subtype === "compact_boundary" &&
    previous.timestamp !== undefined &&
    previous.timestamp.length > 0 &&
    previous.timestamp === message.timestamp;
}

export function projectHistory(
  messages: HistoricalMessage[],
  options: { includeChildMessages?: boolean } = {},
): ConversationItem[] {
  const items: ConversationItem[] = [];
  const toolIndexes = new Map<string, number>();
  let activeAssistantIndex: number | undefined;

  for (const [messageIndex, message] of messages.entries()) {
    if (
      options.includeChildMessages !== true &&
      message.parentToolUseId !== null
    ) {
      continue;
    }
    const payload = record(message.message);
    const content = payload?.content;
    const createdAt = message.timestamp ?? fallbackTimestamp;
    const text = contentText(content);

    if (message.type === "user" && payload?.role === "user") {
      const generatedCompactSummary = followsCompactBoundary(
        message,
        messages[messageIndex - 1],
      );
      if (
        !generatedCompactSummary &&
        text !== undefined &&
        isProductUserText(text)
      ) {
        items.push({
          id: message.id,
          sessionId: message.sessionId,
          kind: "user",
          text,
          createdAt,
        });
        activeAssistantIndex = undefined;
      }
      if (generatedCompactSummary) {
        activeAssistantIndex = undefined;
      }
      for (const block of contentBlocks(content)) {
        if (
          block.type !== "tool_result" ||
          typeof block.tool_use_id !== "string"
        ) {
          continue;
        }
        const index = toolIndexes.get(block.tool_use_id);
        const existing = index === undefined ? undefined : items[index];
        if (index === undefined || existing?.kind !== "tool") continue;
        const elapsed = durationMs(existing.startedAt, createdAt);
        items[index] = {
          ...existing,
          lifecycle: block.is_error === true ? "failed" : "completed",
          result: safeRawPayload(block.content),
          completedAt: createdAt,
          ...(elapsed === undefined ? {} : { durationMs: elapsed }),
        };
      }
      continue;
    }

    if (message.type !== "assistant" || payload?.role !== "assistant") {
      continue;
    }
    const blocks = typeof content === "string"
      ? [{ type: "text", text: content }]
      : contentBlocks(content);
    let usedMessageId = false;
    for (const [blockIndex, block] of blocks.entries()) {
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text.length === 0) continue;
        const activeIndex = activeAssistantIndex;
        const active = activeIndex === undefined
          ? undefined
          : items[activeIndex];
        if (activeIndex !== undefined && active?.kind === "assistant") {
          items[activeIndex] = {
            ...active,
            text: `${active.text}${block.text}`,
            status: "complete",
          };
        } else {
          activeAssistantIndex = items.length;
          items.push({
            id: usedMessageId
              ? stableAssistantItemId(message.id, blockIndex)
              : message.id,
            sessionId: message.sessionId,
            kind: "assistant",
            text: block.text,
            status: "complete",
            createdAt,
          });
          usedMessageId = true;
        }
        continue;
      }
      if (
        block.type !== "tool_use" ||
        typeof block.id !== "string" ||
        block.id.length === 0 ||
        typeof block.name !== "string" ||
        block.name.length === 0
      ) {
        continue;
      }
      activeAssistantIndex = undefined;
      const existingIndex = toolIndexes.get(block.id);
      const existing =
        existingIndex === undefined ? undefined : items[existingIndex];
      if (existingIndex !== undefined && existing?.kind === "tool") {
        items[existingIndex] = {
          ...existing,
          name: block.name,
          input: redactForBrowser(block.input),
        };
        continue;
      }
      const item: ToolItem = {
        id: stableToolItemId(message.id, blockIndex),
        sessionId: message.sessionId,
        kind: "tool",
        toolUseId: block.id,
        name: block.name,
        lifecycle: "requested",
        input: redactForBrowser(block.input),
        startedAt: createdAt,
        createdAt,
      };
      toolIndexes.set(block.id, items.length);
      items.push(item);
    }
  }

  return items;
}
