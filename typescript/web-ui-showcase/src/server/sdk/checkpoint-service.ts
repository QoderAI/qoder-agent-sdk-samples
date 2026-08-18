import { randomUUID } from "node:crypto";
import type {
  CheckpointExecuteCommand,
  CheckpointPreviewCommand,
} from "../../shared/commands.js";
import type {
  CheckpointPreviewView,
  RewindScopeView,
} from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";
import type { EventJournal } from "../realtime/event-journal.js";
import type { SessionCatalog } from "../services/session-catalog-port.js";
import { projectHistory } from "./history-projector.js";
import type { SessionRegistry } from "./session-registry.js";

const previewLifetimeMs = 5 * 60 * 1_000;

type ExecutionResult = {
  status: "success" | "partial" | "rejected";
  failedFiles: Array<{ path: string; error: string }>;
};

/** Requires a recent SDK dry run before any file or conversation rewind. */
export class CheckpointService {
  readonly #registry: SessionRegistry;
  readonly #catalog: SessionCatalog;
  readonly #journal: EventJournal;
  readonly #getSession: (sessionId: string) => { cwd: string } | undefined;
  readonly #createUuid: () => string;
  readonly #now: () => Date;
  readonly #previews = new Map<string, CheckpointPreviewView>();

  constructor(options: {
    registry: SessionRegistry;
    catalog: SessionCatalog;
    journal: EventJournal;
    getSession: (sessionId: string) => { cwd: string } | undefined;
    createUuid?: () => string;
    now?: () => Date;
  }) {
    this.#registry = options.registry;
    this.#catalog = options.catalog;
    this.#journal = options.journal;
    this.#getSession = options.getSession;
    this.#createUuid = options.createUuid ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async preview(
    sessionId: string,
    input: CheckpointPreviewCommand,
  ): Promise<CheckpointPreviewView> {
    return this.#registry.runGuarded(sessionId, () =>
      this.#previewUnlocked(sessionId, input));
  }

  async #previewUnlocked(
    sessionId: string,
    input: CheckpointPreviewCommand,
  ): Promise<CheckpointPreviewView> {
    const controller = this.#controller(sessionId);
    const query = controller.query();
    const timestamp = this.#now();
    let view: Omit<CheckpointPreviewView, "id" | "sessionId" | "userMessageId" | "scope" | "expiresAt">;
    if (input.scope === "files") {
      const result = await query.rewindFiles(input.userMessageId, {
        dryRun: true,
      });
      view = {
        canRewind: result.canRewind,
        status: result.canRewind ? "ready" : "rejected",
        filesChanged: result.filesChanged ?? [],
        insertions: result.insertions ?? 0,
        deletions: result.deletions ?? 0,
        failedFiles: [],
        ...(result.canRewind || result.error === undefined
          ? {}
          : {
              error: {
                code: "CHECKPOINT_REWIND_REJECTED",
                message: "The SDK rejected the file rewind preview.",
                retryable: false,
              },
            }),
      };
    } else {
      this.#requireFullRewind(controller.capabilities());
      const result = await query.rewind(input.userMessageId, {
        scope: input.scope,
        dryRun: true,
      });
      view = {
        canRewind: result.status === "ready",
        status: result.status,
        filesChanged: result.filesChanged ?? [],
        insertions: result.insertions ?? 0,
        deletions: result.deletions ?? 0,
        failedFiles: result.failedFiles ?? [],
        ...(result.status !== "rejected" || result.error === undefined
          ? {}
          : {
              error: {
                code: "CHECKPOINT_REWIND_REJECTED",
                message: "The SDK rejected the Session rewind preview.",
                retryable: false,
              },
            }),
      };
    }
    const preview: CheckpointPreviewView = {
      id: this.#createUuid(),
      sessionId,
      userMessageId: input.userMessageId,
      scope: input.scope,
      expiresAt: new Date(timestamp.getTime() + previewLifetimeMs).toISOString(),
      ...view,
    };
    this.#previews.set(preview.id, preview);
    this.#journal.publish(
      { type: "checkpoint.previewed", payload: preview },
      { sessionId },
    );
    return preview;
  }

  async execute(
    sessionId: string,
    input: CheckpointExecuteCommand,
  ): Promise<void> {
    await this.#registry.runGuarded(sessionId, () =>
      this.#executeUnlocked(sessionId, input));
  }

  async #executeUnlocked(
    sessionId: string,
    input: CheckpointExecuteCommand,
  ): Promise<void> {
    const controller = this.#controller(sessionId);
    const preview = this.#consume(sessionId, input);
    let result: ExecutionResult;
    if (input.scope === "files") {
      const executed = await controller.query().rewindFiles(input.userMessageId);
      if (!executed.canRewind) {
        throw this.#rejectedExecution();
      }
      result = { status: "success", failedFiles: [] };
    } else {
      this.#requireFullRewind(controller.capabilities());
      const executed = await controller.query().rewind(input.userMessageId, {
        scope: input.scope,
      });
      if (executed.status === "ready" || executed.status === "rejected") {
        throw this.#rejectedExecution();
      }
      result = {
        status: executed.status,
        failedFiles: executed.failedFiles ?? [],
      };
    }
    const session = this.#getSession(sessionId);
    if (session === undefined) {
      throw new AppError({
        code: "SESSION_NOT_FOUND",
        message: "The selected Session no longer exists.",
        status: 404,
        retryable: false,
      });
    }
    const messages = projectHistory(
      await this.#catalog.messages(session.cwd, sessionId),
    );
    this.#journal.publish(
      {
        type: "conversation.replaced",
        payload: { sessionId, items: messages },
      },
      { sessionId },
    );
    this.#journal.publish(
      {
        type: "checkpoint.completed",
        payload: {
          sessionId,
          previewId: preview.id,
          status: result.status,
          failedFiles: result.failedFiles.map((failure) => failure.path),
        },
      },
      { sessionId },
    );
  }

  previews(sessionId?: string): CheckpointPreviewView[] {
    this.#removeExpired();
    return [...this.#previews.values()].filter(
      (preview) => sessionId === undefined || preview.sessionId === sessionId,
    );
  }

  clearSession(sessionId: string): void {
    for (const preview of this.previews(sessionId)) {
      this.#remove(preview);
    }
  }

  #controller(sessionId: string) {
    const controller = this.#registry.get(sessionId);
    if (controller === undefined) {
      throw new AppError({
        code: "SESSION_NOT_LIVE",
        message: "此 Session 当前不可用。请重新选择该 Session 后重试 Checkpoint。",
        status: 409,
        retryable: true,
      });
    }
    return controller;
  }

  #consume(
    sessionId: string,
    input: CheckpointExecuteCommand,
  ): CheckpointPreviewView {
    const preview = this.#previews.get(input.previewId);
    if (
      preview === undefined ||
      preview.sessionId !== sessionId ||
      preview.userMessageId !== input.userMessageId ||
      preview.scope !== input.scope ||
      !preview.canRewind ||
      this.#now().getTime() >= new Date(preview.expiresAt).getTime()
    ) {
      if (preview !== undefined) this.#remove(preview);
      throw new AppError({
        code: "CHECKPOINT_PREVIEW_INVALID",
        message: "Create a new matching Checkpoint preview before rewinding.",
        status: 409,
        retryable: false,
      });
    }
    this.#remove(preview);
    return preview;
  }

  #removeExpired(): void {
    const now = this.#now().getTime();
    for (const preview of this.#previews.values()) {
      if (now >= new Date(preview.expiresAt).getTime()) this.#remove(preview);
    }
  }

  #remove(preview: CheckpointPreviewView): void {
    this.#previews.delete(preview.id);
    this.#journal.publish(
      {
        type: "checkpoint.removed",
        payload: { sessionId: preview.sessionId, previewId: preview.id },
      },
      { sessionId: preview.sessionId },
    );
  }

  #requireFullRewind(capabilities: readonly string[]): void {
    if (!capabilities.includes("session_rewind_v1")) {
      throw new AppError({
        code: "SDK_CAPABILITY_UNAVAILABLE",
        message: "The connected CLI does not support full Session rewind.",
        status: 409,
        retryable: false,
      });
    }
  }

  #rejectedExecution(): AppError {
    return new AppError({
      code: "CHECKPOINT_REWIND_REJECTED",
      message: "The SDK rejected the Checkpoint execution.",
      status: 409,
      retryable: false,
    });
  }
}
