import type {
  SDKMessage,
  SDKResultError,
} from "@qoder-ai/qoder-agent-sdk";
import type {
  ConversationItem,
  TaskView,
} from "../../shared/model.js";
import type { SessionRuntimePatch } from "./session-runtime-state.js";
import type { WireError } from "../../shared/errors.js";
import {
  redactForBrowser,
  safeRawPayload,
} from "./redact.js";
import { isProductUserText } from "./product-user-message.js";
import { boundedErrorText } from "./error-text-redact.js";

const SDK_ERROR_MESSAGE_LIMIT = 1_024;
const SDK_ERROR_REASON_LIMIT = 160;

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;
type ToolUpdatePatch = Partial<
  Omit<ToolItem, "id" | "sessionId" | "kind" | "toolUseId" | "createdAt">
>;
type TaskPatch = Partial<Omit<TaskView, "sessionId" | "taskId">>;

function sdkResultFallback(subtype: SDKResultError["subtype"]): string {
  switch (subtype) {
    case "error_during_execution":
      return "SDK 执行过程中发生错误。";
    case "error_max_turns":
      return "SDK 已达到最大轮次限制。";
    case "error_max_budget_usd":
      return "SDK 已达到预算限制。";
  }
}

function sdkResultWireError(message: SDKResultError): WireError {
  const cause = message.errors
    .map((candidate) => boundedErrorText(candidate, SDK_ERROR_MESSAGE_LIMIT))
    .find((candidate) => candidate.length > 0);
  const terminalReason =
    typeof message.terminal_reason === "string"
      ? boundedErrorText(message.terminal_reason, SDK_ERROR_REASON_LIMIT)
      : "";
  return {
    code: "SDK_RESULT_ERROR",
    message: cause ?? sdkResultFallback(message.subtype),
    retryable: true,
    details: {
      subtype: message.subtype,
      ...(message.error_code === undefined
        ? {}
        : { error_code: message.error_code }),
      ...(terminalReason.length === 0
        ? {}
        : { terminal_reason: terminalReason }),
    },
  };
}

function sdkResultDiagnostic(message: SDKResultError): Record<string, unknown> {
  const error = sdkResultWireError(message);
  const terminalReason = error.details?.terminal_reason;
  return {
    type: "result",
    subtype: message.subtype,
    ...(message.error_code === undefined
      ? {}
      : { error_code: message.error_code }),
    summary: error.message,
    ...(typeof terminalReason === "string"
      ? { terminal_reason: terminalReason }
      : {}),
  };
}

export type ProjectionAction =
  | { type: "conversation.add"; item: ConversationItem }
  | { type: "assistant.delta"; sourceId: string; text: string }
  | { type: "assistant.finalize"; sourceId: string; text: string }
  | {
      type: "conversation.update-tool";
      toolUseId: string;
      patch: ToolUpdatePatch;
    }
  | { type: "task.upsert"; task: TaskView }
  | { type: "task.patch"; taskId: string; patch: TaskPatch }
  | { type: "background-tasks.replace"; tasks: TaskView[] }
  | { type: "task.remove"; taskId: string }
  | { type: "session.title-changed"; title: string }
  | { type: "runtime.patch"; patch: SessionRuntimePatch }
  | { type: "session.state"; state: "idle" | "running" | "requires_action" }
  | { type: "turn.completed"; success: boolean; error?: WireError };

export type ProjectionContext = {
  sessionId: string;
  now: () => string;
  createId: () => string;
  includeRawEvents?: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function textContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      const candidate = objectValue(block);
      return candidate?.type === "text" && typeof candidate.text === "string"
        ? candidate.text
        : "";
    })
    .join("");
}

function projectAssistant(
  message: Extract<SDKMessage, { type: "assistant" }>,
  context: ProjectionContext,
): ProjectionAction[] {
  const actions: ProjectionAction[] = [];
  const content = message.message.content;
  const hasTool = content.some((block) => block.type === "tool_use");
  const hasMultipleTextBlocks =
    content.filter((block) => block.type === "text").length > 1;
  for (const [blockIndex, block] of content.entries()) {
    if (
      block.type === "text" &&
      typeof block.text === "string" &&
      block.text.length > 0
    ) {
      actions.push({
        type: "assistant.finalize",
        sourceId: hasTool || hasMultipleTextBlocks
          ? `${message.uuid}:text:${blockIndex}`
          : message.uuid,
        text: block.text,
      });
      continue;
    }
    if (
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      const startedAt = context.now();
      actions.push({
        type: "conversation.add",
        item: {
          id: context.createId(),
          sessionId: context.sessionId,
          kind: "tool",
          toolUseId: block.id,
          name: block.name,
          lifecycle: "requested",
          input: redactForBrowser(block.input),
          startedAt,
          createdAt: startedAt,
        },
      });
    }
  }
  return actions;
}

function observedType(message: SDKMessage): string {
  if (message.type === "system") return `system.${message.subtype}`;
  if (message.type === "result") return `result.${message.subtype}`;
  return typeof (message as { type?: unknown }).type === "string"
    ? (message as { type: string }).type
    : "unknown";
}

function observeMessage(
  message: SDKMessage,
  context: ProjectionContext,
): ProjectionAction {
  return {
    type: "runtime.patch",
    patch: {
      rawEvents: [
        {
          messageType: observedType(message),
          occurredAt: context.now(),
          payload: safeRawPayload(
            message.type === "result" && message.subtype !== "success"
              ? sdkResultDiagnostic(message)
              : message,
          ),
        },
      ],
    },
  };
}

function projectUser(
  message: Extract<SDKMessage, { type: "user" }>,
  context: ProjectionContext,
): ProjectionAction[] {
  const content = message.message.content;
  const actions: ProjectionAction[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        actions.push({
          type: "conversation.update-tool",
          toolUseId: block.tool_use_id,
          patch: {
            lifecycle: block.is_error === true ? "failed" : "completed",
            result: safeRawPayload(block.content),
            completedAt: context.now(),
          },
        });
      }
    }
  }
  const text = textContent(content);
  if (message.isSynthetic !== true && isProductUserText(text)) {
    actions.unshift({
      type: "conversation.add",
      item: {
        id: message.uuid ?? context.createId(),
        sessionId: context.sessionId,
        kind: "user",
        text,
        ...(message.uuid === undefined ? {} : { messageUuid: message.uuid }),
        createdAt: message.timestamp ?? context.now(),
      },
    });
  }
  return actions;
}

function hookPhase(
  subtype: "hook_started" | "hook_progress" | "hook_response",
): "started" | "progress" | "completed" {
  switch (subtype) {
    case "hook_started":
      return "started";
    case "hook_progress":
      return "progress";
    case "hook_response":
      return "completed";
  }
}

function projectSystem(
  message: Extract<SDKMessage, { type: "system" }>,
  context: ProjectionContext,
): ProjectionAction[] {
  switch (message.subtype) {
    case "task_started":
      return [
        ...(message.tool_use_id === undefined
          ? []
          : [
              {
                type: "conversation.update-tool" as const,
                toolUseId: message.tool_use_id,
                patch: { lifecycle: "running" as const },
              },
            ]),
        {
          type: "task.upsert",
          task: {
            sessionId: context.sessionId,
            taskId: message.task_id,
            name: message.description,
            status: "running",
            foreground: true,
            ...(message.tool_use_id === undefined
              ? {}
              : { toolUseId: message.tool_use_id }),
          },
        },
      ];
    case "task_progress":
      return [
        {
          type: "task.upsert",
          task: {
            sessionId: context.sessionId,
            taskId: message.task_id,
            name: message.description,
            status: "running",
            foreground: true,
            ...(message.usage?.duration_ms === undefined
              ? {}
              : { elapsedMs: message.usage.duration_ms }),
            ...(message.tool_use_id === undefined
              ? {}
              : { toolUseId: message.tool_use_id }),
          },
        },
      ];
    case "task_notification":
      return [
        {
          type: "task.upsert",
          task: {
            sessionId: context.sessionId,
            taskId: message.task_id,
            name: message.summary || "Background task",
            status: message.status,
            foreground: false,
            ...(message.usage?.duration_ms === undefined
              ? {}
              : { elapsedMs: message.usage.duration_ms }),
            ...(message.tool_use_id === undefined
              ? {}
              : { toolUseId: message.tool_use_id }),
          },
        },
      ];
    case "task_updated":
      return [
        {
          type: "task.patch",
          taskId: message.task_id,
          patch: {
            ...(message.patch.description === undefined
              ? {}
              : { name: message.patch.description }),
            ...(message.patch.status === undefined
              ? {}
              : { status: message.patch.status }),
            ...(message.patch.is_backgrounded === undefined
              ? {}
              : { foreground: !message.patch.is_backgrounded }),
          },
        },
      ];
    case "background_tasks_changed":
      return [{
        type: "background-tasks.replace",
        tasks: message.tasks.map((task) => ({
          sessionId: context.sessionId,
          taskId: task.task_id,
          name: task.description,
          status: "running",
          foreground: false,
        })),
      }];
    case "hook_started":
    case "hook_progress":
    case "hook_response":
      return [
        {
          type: "runtime.patch",
          patch: {
            hooks: [{
              source: "sdk-event",
              event: message.hook_event,
              phase: hookPhase(message.subtype),
              hookId: message.hook_id,
              hookName: message.hook_name,
              ...(message.subtype === "hook_response"
                ? { outcome: message.outcome }
                : {}),
              occurredAt: context.now(),
            }],
          },
        },
      ];
    case "compact_boundary":
      return [
        {
          type: "conversation.add",
          item: {
            id: message.uuid,
            sessionId: context.sessionId,
            kind: "progress",
            label: "Context compacted",
            detail: `${message.compact_metadata.pre_tokens} tokens before compaction`,
            createdAt: context.now(),
          },
        },
      ];
    case "api_retry":
      return [
        {
          type: "conversation.add",
          item: {
            id: message.uuid,
            sessionId: context.sessionId,
            kind: "progress",
            label: "Retrying model request",
            detail: `Attempt ${message.attempt} of ${message.max_retries}`,
            createdAt: context.now(),
          },
        },
      ];
    case "permission_denied":
      return [
        {
          type: "conversation.add",
          item: {
            id: message.uuid,
            sessionId: context.sessionId,
            kind: "error",
            error: {
              code: "TOOL_PERMISSION_DENIED",
              message: boundedErrorText(
                message.message,
                SDK_ERROR_MESSAGE_LIMIT,
              ),
              retryable: true,
            },
            createdAt: context.now(),
          },
        },
      ];
    case "init":
      return [
        {
          type: "runtime.patch",
          patch: { versions: { cli: message.qodercli_version } },
        },
      ];
    case "session_state_changed":
      return [{ type: "session.state", state: message.state }];
    case "status":
    case "files_persisted":
    case "elicitation_complete":
      return [];
    case "session_title_changed":
      return [{ type: "session.title-changed", title: message.title }];
    default:
      return [];
  }
}

function projectMessage(
  message: SDKMessage,
  context: ProjectionContext,
): ProjectionAction[] {
  switch (message.type) {
    case "assistant":
      return projectAssistant(message, context);
    case "user":
      return projectUser(message, context);
    case "stream_event": {
      const delta = objectValue(message.event.delta);
      const text = typeof delta?.text === "string" ? delta.text : undefined;
      return text === undefined
        ? []
        : [
            {
              type: "assistant.delta",
              sourceId: message.uuid,
              text,
            },
          ];
    }
    case "result":
      if (message.subtype === "success") {
        return [
          { type: "turn.completed", success: true },
        ];
      }
      {
        const error = sdkResultWireError(message);
        return [
          {
            type: "conversation.add",
            item: {
              id: context.createId(),
              sessionId: context.sessionId,
              kind: "error",
              error,
              createdAt: context.now(),
            },
          },
          { type: "turn.completed", success: false, error },
        ];
      }
    case "system":
      return projectSystem(message, context);
    case "prompt_suggestion":
      return [
        {
          type: "runtime.patch",
          patch: { promptSuggestions: [message.suggestion] },
        },
      ];
    case "cloud_agent_event":
      return [];
    default:
      return [];
  }
}

export function projectSdkMessage(
  message: SDKMessage,
  context: ProjectionContext,
): ProjectionAction[] {
  const isChildAgentMessage =
    (message.type === "user" ||
      message.type === "assistant" ||
      message.type === "stream_event") &&
    message.parent_tool_use_id !== null;
  const semantic = isChildAgentMessage ? [] : projectMessage(message, context);
  return context.includeRawEvents === false
    ? semantic
    : [observeMessage(message, context), ...semantic];
}
