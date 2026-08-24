import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  CheckpointExecuteCommand,
  CheckpointPreviewCommand,
} from "../../../shared/commands.js";
import type {
  CheckpointPreviewView,
  ConversationItem,
  RewindScopeView,
  SessionView,
} from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { useModalFocus } from "../layout/modal-focus.js";

type UserItem = Extract<ConversationItem, { kind: "user" }>;
type Accepted = { commandId: string };

export type CheckpointApi = {
  previewCheckpoint(
    sessionId: string,
    input: CheckpointPreviewCommand,
  ): Promise<Accepted>;
  executeCheckpoint(
    sessionId: string,
    input: CheckpointExecuteCommand,
  ): Promise<Accepted>;
};

type RequestPhase = "idle" | "previewing" | "executing";
const maximumTimerDelayMs = 2_147_483_647;

function latestMatchingPreview(
  previews: CheckpointPreviewView[],
  target: UserItem,
  scope: RewindScopeView,
): CheckpointPreviewView | undefined {
  return [...previews].reverse().find(
    (preview) =>
      preview.sessionId === target.sessionId &&
      preview.userMessageId === target.id &&
      preview.scope === scope,
  );
}

export function CheckpointDialog(props: {
  api: CheckpointApi;
  session: SessionView;
  target: UserItem;
  returnFocus: HTMLElement | null;
  onClose(): void;
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLElement>(null);
  const firstScope = useRef<HTMLInputElement>(null);
  const [scope, setScope] = useState<RewindScopeView>("files");
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const [previewCommandId, setPreviewCommandId] = useState<string | null>(null);
  const [executeCommandId, setExecuteCommandId] = useState<string | null>(null);
  const [executionPreviewId, setExecutionPreviewId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const supportsFullRewind =
    props.session.capabilities?.includes("session_rewind_v1") === true;
  const sessionBusy = props.session.phase !== "idle" || props.session.awaitingUser;
  const previews = state.checkpointPreviewIds.flatMap((id) => {
    const preview = state.checkpointPreviews[id];
    return preview === undefined ? [] : [preview];
  });
  const preview = latestMatchingPreview(previews, props.target, scope);
  const completion = executionPreviewId === null
    ? undefined
    : state.checkpointCompletions[executionPreviewId];
  const commandFailure = [...state.commandFailures].reverse().find(
    (failure) =>
      failure.commandId === previewCommandId ||
      failure.commandId === executeCommandId,
  );
  const expired = preview !== undefined &&
    clock >= new Date(preview.expiresAt).getTime();
  const busy = phase !== "idle";

  useModalFocus({
    open: true,
    dialogRef: dialog,
    initialFocusRef: firstScope,
    returnFocus: props.returnFocus,
    onClose: props.onClose,
  });

  useEffect(() => {
    if (preview === undefined) return;
    const expiresAt = new Date(preview.expiresAt).getTime();
    const timeout = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(
        Math.max(0, expiresAt - Date.now()) + 10,
        maximumTimerDelayMs,
      ),
    );
    return () => window.clearTimeout(timeout);
  }, [preview]);

  useEffect(() => {
    if (phase === "previewing" && preview !== undefined) {
      setPhase("idle");
    }
  }, [phase, preview]);

  useEffect(() => {
    if (commandFailure === undefined) return;
    setPhase("idle");
    setSubmissionError(commandFailure.error.message);
    if (commandFailure.commandId === executeCommandId) {
      setExecutionPreviewId(null);
    }
    if (commandFailure.commandId !== undefined) {
      store.dismissCommandFailure(commandFailure.commandId);
    }
  }, [commandFailure, executeCommandId, store]);

  useEffect(() => {
    if (completion !== undefined) {
      setPhase("idle");
    }
  }, [completion]);

  const selectScope = (nextScope: RewindScopeView): void => {
    setScope(nextScope);
    setSubmissionError(null);
    setPreviewCommandId(null);
    setExecuteCommandId(null);
    setExecutionPreviewId(null);
    setClock(Date.now());
  };

  const requestPreview = (): void => {
    if (busy || sessionBusy) return;
    setPhase("previewing");
    setSubmissionError(null);
    setPreviewCommandId(null);
    setExecuteCommandId(null);
    setExecutionPreviewId(null);
    void props.api.previewCheckpoint(props.session.id, {
      userMessageId: props.target.id,
      scope,
    }).then(
      (accepted) => {
        setPreviewCommandId(accepted.commandId);
        store.registerCommand(accepted.commandId, {
          surface: "conversation",
          control: "checkpoint-preview",
          sessionId: props.session.id,
        });
      },
      (error: unknown) => {
        setPhase("idle");
        setSubmissionError(
          error instanceof Error ? error.message : copy.checkpoint.requestFailed,
        );
      },
    );
  };

  const execute = (): void => {
    if (
      busy ||
      sessionBusy ||
      preview === undefined ||
      expired ||
      !preview.canRewind ||
      preview.status !== "ready"
    ) {
      return;
    }
    setPhase("executing");
    setSubmissionError(null);
    setExecuteCommandId(null);
    setExecutionPreviewId(preview.id);
    void props.api.executeCheckpoint(props.session.id, {
      previewId: preview.id,
      userMessageId: props.target.id,
      scope,
    }).then(
      (accepted) => {
        setExecuteCommandId(accepted.commandId);
        store.registerCommand(accepted.commandId, {
          surface: "conversation",
          control: "checkpoint-execute",
          sessionId: props.session.id,
        });
      },
      (error: unknown) => {
        setPhase("idle");
        setExecutionPreviewId(null);
        setSubmissionError(
          error instanceof Error ? error.message : copy.checkpoint.requestFailed,
        );
      },
    );
  };

  const failureMessage = submissionError ?? commandFailure?.error.message;
  const visibleFiles = preview?.filesChanged.slice(0, 20) ?? [];

  return createPortal(
    <div className="dialog-backdrop">
      <section
        ref={dialog}
        className="dialog checkpoint-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <h2 id={titleId}>{copy.checkpoint.dialogTitle}</h2>
        <p id={descriptionId}>{copy.checkpoint.description}</p>

        <fieldset className="checkpoint-scopes" disabled={busy || completion !== undefined}>
          <legend>{copy.checkpoint.scope}</legend>
          <label>
            <input
              ref={firstScope}
              type="radio"
              name="checkpoint-scope"
              value="files"
              checked={scope === "files"}
              onChange={() => selectScope("files")}
            />
            <span>{copy.checkpoint.files}</span>
          </label>
          <label>
            <input
              type="radio"
              name="checkpoint-scope"
              value="conversation"
              checked={scope === "conversation"}
              disabled={!supportsFullRewind}
              onChange={() => selectScope("conversation")}
            />
            <span>{copy.checkpoint.conversation}</span>
          </label>
          <label>
            <input
              type="radio"
              name="checkpoint-scope"
              value="both"
              checked={scope === "both"}
              disabled={!supportsFullRewind}
              onChange={() => selectScope("both")}
            />
            <span>{copy.checkpoint.both}</span>
          </label>
        </fieldset>
        {supportsFullRewind ? null : (
          <p className="checkpoint-hint">{copy.checkpoint.fullRewindUnavailable}</p>
        )}
        {sessionBusy ? (
          <p className="checkpoint-hint" role="status">
            {copy.checkpoint.sessionBusy}
          </p>
        ) : null}

        {phase === "previewing" ? (
          <p className="checkpoint-status" role="status">
            {copy.checkpoint.previewing}
          </p>
        ) : null}
        {phase === "executing" && completion === undefined ? (
          <p className="checkpoint-status" role="status">
            {copy.checkpoint.executing}
          </p>
        ) : null}

        {preview === undefined || phase === "executing" ? null : (
          <section className="checkpoint-impact" aria-labelledby={`${titleId}-impact`}>
            <h3 id={`${titleId}-impact`}>{copy.checkpoint.impact}</h3>
            {preview.canRewind ? (
              <>
                <dl>
                  <div>
                    <dt>{copy.checkpoint.changedFiles}</dt>
                    <dd>{preview.filesChanged.length}</dd>
                  </div>
                  <div>
                    <dt>{copy.checkpoint.insertions}</dt>
                    <dd className="checkpoint-insertions">+{preview.insertions}</dd>
                  </div>
                  <div>
                    <dt>{copy.checkpoint.deletions}</dt>
                    <dd className="checkpoint-deletions">−{preview.deletions}</dd>
                  </div>
                </dl>
                {visibleFiles.length === 0 ? (
                  <p>{copy.checkpoint.noChangedFiles}</p>
                ) : (
                  <ul className="checkpoint-files">
                    {visibleFiles.map((file) => <li key={file}><code>{file}</code></li>)}
                    {preview.filesChanged.length <= visibleFiles.length ? null : (
                      <li>另有 {preview.filesChanged.length - visibleFiles.length} 个文件</li>
                    )}
                  </ul>
                )}
              </>
            ) : (
              <p className="form-error" role="alert">
                {preview.error?.message ?? copy.checkpoint.rejected}
              </p>
            )}
            {expired ? (
              <p className="form-error" role="alert">{copy.checkpoint.expired}</p>
            ) : null}
            {preview.failedFiles.length === 0 ? null : (
              <div className="checkpoint-failures">
                <strong>{copy.checkpoint.failedFiles}</strong>
                <ul>
                  {preview.failedFiles.map((failure) => (
                    <li key={failure.path}>{failure.path}: {failure.error}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {completion === undefined ? null : (
          <div className="checkpoint-completion" role="status">
            <strong>
              {completion.status === "partial"
                ? copy.checkpoint.partial
                : copy.checkpoint.completed}
            </strong>
            {completion.failedFiles.length === 0 ? null : (
              <ul>
                {completion.failedFiles.map((file) => <li key={file}>{file}</li>)}
              </ul>
            )}
          </div>
        )}

        {failureMessage === undefined || failureMessage === null ? null : (
          <p className="form-error" role="alert">{failureMessage}</p>
        )}

        <div className="dialog-actions">
          <button
            type="button"
            className="button ghost"
            onClick={props.onClose}
          >
            {completion === undefined ? copy.common.cancel : copy.common.close}
          </button>
          {completion !== undefined ? null : preview === undefined || expired ? (
            <button
              type="button"
              className="button primary"
              disabled={busy || sessionBusy}
              onClick={requestPreview}
            >
              {phase === "previewing"
                ? copy.checkpoint.previewing
                : copy.checkpoint.preview}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button ghost"
                disabled={busy}
                onClick={requestPreview}
              >
                {copy.checkpoint.previewAgain}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  busy ||
                  sessionBusy ||
                  !preview.canRewind ||
                  preview.status !== "ready"
                }
                onClick={execute}
              >
                {phase === "executing"
                  ? copy.checkpoint.executing
                  : copy.checkpoint.execute}
              </button>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
