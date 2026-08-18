import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  ElicitationResult,
  OnElicitation,
  PermissionResult,
  PermissionUpdate,
} from "@qoder-ai/qoder-agent-sdk";
import type { InteractionResponse } from "../../shared/commands.js";
import {
  snapshotMcpElicitationSchema,
  validateMcpElicitationContent,
  type McpElicitationScalar,
  type McpElicitationSchemaSnapshot,
} from "../../shared/mcp-elicitation-schema.js";
import type { InteractionView } from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import {
  applyQuestionAnswers,
  parseAskUserQuestions,
  type ParsedQuestion,
} from "./ask-user.js";
import { redactForBrowser } from "./redact.js";

type ToolApprovalView = Extract<
  InteractionView,
  { kind: "tool-approval" }
>;
type QuestionView = Extract<InteractionView, { kind: "question" }>;
type McpElicitationView = Extract<
  InteractionView,
  { kind: "mcp-elicitation" }
>;

type PendingBase = {
  sessionId: string;
  reject: (error: unknown) => void;
  removeAbortListener: () => void;
};

type ToolPending = PendingBase & {
  kind: "tool-approval";
  view: ToolApprovalView;
  suggestions: PermissionUpdate[];
  resolve: (result: PermissionResult) => void;
};

type QuestionPending = PendingBase & {
  kind: "question";
  view: QuestionView;
  input: Record<string, unknown>;
  questions: ParsedQuestion[];
  resolve: (result: PermissionResult) => void;
};

type ElicitationPending = PendingBase & {
  kind: "mcp-elicitation";
  view: McpElicitationView;
  schemaSnapshot: McpElicitationSchemaSnapshot;
  resolve: (result: ElicitationResult) => void;
};

type PendingInteraction =
  | ToolPending
  | QuestionPending
  | ElicitationPending;

function summarizeSuggestion(
  suggestion: PermissionUpdate,
  index: number,
): ToolApprovalView["permissionSuggestions"][number] {
  switch (suggestion.type) {
    case "setMode":
      return {
        index,
        label: `Set ${suggestion.destination} mode`,
        description: `Use ${suggestion.mode} permission mode.`,
      };
    case "addDirectories":
    case "removeDirectories":
      return {
        index,
        label: `${suggestion.type === "addDirectories" ? "Add" : "Remove"} directories`,
        description: `${suggestion.directories.length} director${suggestion.directories.length === 1 ? "y" : "ies"} in ${suggestion.destination}.`,
      };
    case "addRules":
    case "replaceRules":
    case "removeRules":
      return {
        index,
        label: `${suggestion.type} in ${suggestion.destination}`,
        description: `${suggestion.behavior} for ${suggestion.rules.length} rule${suggestion.rules.length === 1 ? "" : "s"}.`,
      };
  }
}

function safeHttpUrl(
  value: string | undefined,
): { url?: string; validationError?: string } {
  if (value === undefined) {
    return {};
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { url: url.toString() };
    }
  } catch {
    return { validationError: "The MCP server returned an invalid URL." };
  }
  return { validationError: "The MCP server returned an unsupported URL." };
}

export class InteractionBroker {
  readonly #journal: EventJournal;
  readonly #createUuid: () => string;
  readonly #now: () => string;
  readonly #pending = new Map<string, PendingInteraction>();
  readonly #subscribers = new Map<string, Set<(pendingCount: number) => void>>();

  constructor(options: {
    journal: EventJournal;
    createUuid?: () => string;
    now?: () => string;
  }) {
    this.#journal = options.journal;
    this.#createUuid = options.createUuid ?? randomUUID;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  canUseTool(getSessionId: () => string): CanUseTool {
    return (toolName, input, options) => {
      const currentSessionId = getSessionId();
      if (toolName === "AskUserQuestion") {
        const questions = parseAskUserQuestions(input);
        const view: QuestionView = {
          id: this.#createUuid(),
          sessionId: currentSessionId,
          kind: "question",
          questions,
          openedAt: this.#now(),
          status: "pending",
        };
        return new Promise<PermissionResult>((resolve, reject) => {
          const abort = () => {
            this.#cancel(view.id, this.#abortedError());
          };
          const pending: QuestionPending = {
            kind: "question",
            sessionId: currentSessionId,
            view,
            input,
            questions,
            resolve,
            reject,
            removeAbortListener: () =>
              options.signal.removeEventListener("abort", abort),
          };
          this.#open(pending, options.signal, abort);
        });
      }

      const suggestions = [...(options.suggestions ?? [])];
      const view: ToolApprovalView = {
        id: this.#createUuid(),
        sessionId: currentSessionId,
        kind: "tool-approval",
        toolName,
        input: redactForBrowser(input),
        permissionSuggestions: suggestions.map(summarizeSuggestion),
        openedAt: this.#now(),
        status: "pending",
      };
      return new Promise<PermissionResult>((resolve, reject) => {
        const abort = () => {
          this.#cancel(view.id, this.#abortedError());
        };
        const pending: ToolPending = {
          kind: "tool-approval",
          sessionId: currentSessionId,
          view,
          suggestions,
          resolve,
          reject,
          removeAbortListener: () =>
            options.signal.removeEventListener("abort", abort),
        };
        this.#open(pending, options.signal, abort);
      });
    };
  }

  onElicitation(getSessionId: () => string): OnElicitation {
    return (request, options) => {
      const currentSessionId = getSessionId();
      const safeUrl = safeHttpUrl(request.url);
      const schemaSnapshot = snapshotMcpElicitationSchema(
        request.requestedSchema ?? { type: "object" },
      );
      const view: McpElicitationView = {
        id: this.#createUuid(),
        sessionId: currentSessionId,
        kind: "mcp-elicitation",
        serverName: request.serverName,
        mode: request.mode ?? "form",
        prompt: request.message,
        requestedSchema: schemaSnapshot.schema,
        ...safeUrl,
        openedAt: this.#now(),
        status: "pending",
      };
      return new Promise<ElicitationResult>((resolve, reject) => {
        const abort = () => {
          this.#cancel(view.id, this.#abortedError());
        };
        const pending: ElicitationPending = {
          kind: "mcp-elicitation",
          sessionId: currentSessionId,
          view,
          schemaSnapshot,
          resolve,
          reject,
          removeAbortListener: () =>
            options.signal.removeEventListener("abort", abort),
        };
        this.#open(pending, options.signal, abort);
      });
    };
  }

  respond(
    interactionId: string,
    response: InteractionResponse,
    commandId?: string,
  ): void {
    const pending = this.#pending.get(interactionId);
    if (pending === undefined) {
      throw new AppError({
        code: "INTERACTION_NOT_PENDING",
        message: "This interaction has already been resolved.",
        status: 409,
        retryable: false,
      });
    }

    if (pending.kind === "tool-approval") {
      if (response.kind === "allow") {
        const indexes = [...new Set(response.suggestionIndexes)];
        if (
          indexes.some((index) => pending.suggestions[index] === undefined)
        ) {
          throw this.#invalidResponse("A permission suggestion is invalid.");
        }
        const selected = indexes.map(
          (index) => pending.suggestions[index] as PermissionUpdate,
        );
        this.#finish(pending, "allow", commandId);
        pending.resolve({
          behavior: "allow",
          ...(selected.length === 0
            ? {}
            : { updatedPermissions: selected }),
        });
        return;
      }
      if (response.kind === "deny") {
        this.#finish(pending, "deny", commandId);
        pending.resolve({
          behavior: "deny",
          message: response.message,
          interrupt: response.interrupt,
        });
        return;
      }
      throw this.#invalidResponse("Use an approval response for this tool.");
    }

    if (pending.kind === "question") {
      if (response.kind === "answer") {
        for (const question of pending.questions) {
          const answer = response.answers[question.question];
          if (answer === undefined || answer.trim().length === 0) {
            throw this.#invalidResponse(
              `Answer the question: ${question.question}`,
            );
          }
        }
        this.#finish(pending, "answer", commandId);
        pending.resolve({
          behavior: "allow",
          updatedInput: applyQuestionAnswers(
            pending.input,
            response.answers,
          ),
        });
        return;
      }
      if (response.kind === "deny") {
        this.#finish(pending, "deny", commandId);
        pending.resolve({
          behavior: "deny",
          message: response.message,
          interrupt: response.interrupt,
        });
        return;
      }
      throw this.#invalidResponse("Answer or deny this question.");
    }

    if (response.kind !== "elicit") {
      throw this.#invalidResponse("Use an elicitation response.");
    }
    const content = this.#validateElicitationResponse(pending, response);
    this.#finish(pending, response.action, commandId);
    pending.resolve({
      action: response.action,
      ...(response.action === "accept" && content !== undefined
        ? { content }
        : {}),
    });
  }

  /** Validates a response synchronously without consuming its interaction. */
  validateResponse(
    interactionId: string,
    response: InteractionResponse,
  ): void {
    const pending = this.#pending.get(interactionId);
    if (pending === undefined) {
      throw new AppError({
        code: "INTERACTION_NOT_PENDING",
        message: "This interaction has already been resolved.",
        status: 409,
        retryable: false,
      });
    }
    if (pending.kind === "mcp-elicitation") {
      if (response.kind !== "elicit") {
        throw this.#invalidResponse("Use an elicitation response.");
      }
      this.#validateElicitationResponse(pending, response);
    }
  }

  pending(sessionId?: string): InteractionView[] {
    return [...this.#pending.values()]
      .filter(
        (interaction) =>
          sessionId === undefined || interaction.sessionId === sessionId,
      )
      .map((interaction) => interaction.view);
  }

  subscribe(
    sessionId: string,
    listener: (pendingCount: number) => void,
  ): () => void {
    const listeners = this.#subscribers.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.#subscribers.set(sessionId, listeners);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.#subscribers.delete(sessionId);
      }
    };
  }

  abortSession(sessionId: string, error: Error): void {
    for (const pending of [...this.#pending.values()]) {
      if (pending.sessionId === sessionId) {
        this.#cancel(pending.view.id, error);
      }
    }
  }

  #open(
    pending: PendingInteraction,
    signal: AbortSignal,
    abort: () => void,
  ): void {
    if (signal.aborted) {
      pending.reject(this.#abortedError());
      return;
    }
    this.#pending.set(pending.view.id, pending);
    signal.addEventListener("abort", abort, { once: true });
    this.#journal.publish(
      { type: "interaction.opened", payload: pending.view },
      { sessionId: pending.sessionId },
    );
    this.#notify(pending.sessionId);
  }

  #finish(
    pending: PendingInteraction,
    decision: string,
    commandId?: string,
  ): void {
    this.#pending.delete(pending.view.id);
    pending.removeAbortListener();
    this.#journal.publish(
      {
        type: "interaction.resolved",
        payload: {
          interactionId: pending.view.id,
          status: "resolved",
          resolvedAt: this.#now(),
          decision,
        },
      },
      {
        sessionId: pending.sessionId,
        ...(commandId === undefined ? {} : { commandId }),
      },
    );
    this.#notify(pending.sessionId);
  }

  #cancel(interactionId: string, error: Error): void {
    const pending = this.#pending.get(interactionId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(interactionId);
    pending.removeAbortListener();
    this.#journal.publish(
      {
        type: "interaction.resolved",
        payload: {
          interactionId,
          status: "cancelled",
          resolvedAt: this.#now(),
          decision: "cancelled",
        },
      },
      { sessionId: pending.sessionId },
    );
    this.#notify(pending.sessionId);
    pending.reject(error);
  }

  #notify(sessionId: string): void {
    const count = [...this.#pending.values()].filter(
      (pending) => pending.sessionId === sessionId,
    ).length;
    for (const listener of this.#subscribers.get(sessionId) ?? []) {
      listener(count);
    }
  }

  #validateElicitationResponse(
    pending: ElicitationPending,
    response: Extract<InteractionResponse, { kind: "elicit" }>,
  ): Record<string, McpElicitationScalar> | undefined {
    if (response.action !== "accept") return undefined;
    const parsed = pending.schemaSnapshot.parsed;
    if (!parsed.supported) throw this.#invalidResponse(parsed.reason);
    const validation = validateMcpElicitationContent(
      parsed,
      response.content ?? {},
    );
    if (!validation.valid) throw this.#invalidResponse(validation.reason);
    return response.content === undefined ? undefined : validation.content;
  }

  #abortedError(): AppError {
    return new AppError({
      code: "INTERACTION_ABORTED",
      message: "The Session ended before the interaction was answered.",
      status: 409,
      retryable: true,
    });
  }

  #invalidResponse(message: string): AppError {
    return new AppError({
      code: "INTERACTION_RESPONSE_INVALID",
      message,
      status: 400,
      retryable: false,
    });
  }
}
