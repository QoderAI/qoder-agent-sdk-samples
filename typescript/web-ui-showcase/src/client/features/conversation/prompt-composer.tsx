import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  SessionRuntimeView,
  QueuedInputView,
  SessionView,
} from "../../../shared/model.js";
import type { SelectablePermissionMode } from "../../../shared/commands.js";
import type { WorkspaceFileSearchResult } from "../../../shared/workspace-files.js";
import { copy, queuedStateLabel } from "../../i18n/zh-cn.js";
import {
  ComposerSuggestionList,
  suggestionOptionId,
} from "./composer-suggestion-list.js";
import {
  applySuggestion,
  filterCommandSuggestions,
  normalizePromptSuggestions,
  parseSuggestionQuery,
  resolveCompletedCommand,
  type ActiveSuggestionQuery,
  type ComposerSuggestion,
} from "./composer-suggestions.js";
import {
  ComposerControlMenu,
  runtimeControlReason,
  type RuntimeControlFailure,
  type RuntimeControl,
} from "./composer-control-menu.js";
import { ComposerDrafts } from "./composer-drafts.js";
import { readContextSummary } from "./context-summary.js";

type Accepted = { commandId: string };
const fileSuggestionDebounceMs = 200;
type FileSuggestionState =
  | { status: "idle"; items: []; truncated: false }
  | { status: "loading"; items: []; truncated: false }
  | { status: "failed"; items: []; truncated: false }
  | {
      status: "ready";
      items: WorkspaceFileSearchResult["items"];
      truncated: boolean;
    };

function suggestionQueryKey(query: ActiveSuggestionQuery | null): string | null {
  return query === null
    ? null
    : `${query.kind}:${query.start}:${query.end}:${query.query}`;
}

export type ComposerTarget =
  | {
      kind: "home";
      workspaceId: string | null;
      start(text: string): Promise<void>;
    }
  | {
      kind: "session";
      session: SessionView;
      runtime?: SessionRuntimeView;
      send(text: string): Promise<void>;
      stop(): Promise<void>;
      setModel(model?: string): Promise<Accepted>;
      setPermissionMode(
        mode: SelectablePermissionMode,
      ): Promise<Accepted>;
      openMcp(): void;
      refreshContext(): Promise<void>;
      modelFailure?: RuntimeControlFailure;
      permissionFailure?: RuntimeControlFailure;
    };

type CommonComposerProps = {
  queued?: QueuedInputView[];
  cancel?: (uuid: string) => Promise<Accepted>;
  searchWorkspaceFiles?: (
    sessionId: string,
    query: string,
    signal?: AbortSignal,
  ) => Promise<WorkspaceFileSearchResult>;
};

type PromptComposerProps = CommonComposerProps & {
  target: ComposerTarget;
  drafts: ComposerDrafts;
  autoResuming?: boolean;
  disabledReason?: string;
};

export function PromptComposer(props: PromptComposerProps): JSX.Element {
  const { drafts, target } = props;
  const session = target.kind === "session" ? target.session : undefined;
  const runtime = target.kind === "session" ? target.runtime : undefined;
  const draftKey = target.kind === "home" ? "home" : target.session.id;
  const draft = drafts.read(draftKey);
  const [, setDraftRevision] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedQueryKey, setDismissedQueryKey] = useState<string | null>(null);
  const [fileState, setFileState] = useState<FileSuggestionState>({
    status: "idle",
    items: [],
    truncated: false,
  });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const modelControl = useRef<HTMLSelectElement>(null);
  const permissionControl = useRef<HTMLSelectElement>(null);
  const restoreCaret = useRef(false);
  const requestSequence = useRef(0);
  const activeDraftKey = useRef(draftKey);
  const submittingDrafts = useRef(new Set<string>());
  const [, setSubmissionRevision] = useState(0);
  activeDraftKey.current = draftKey;
  const enabled =
    !props.autoResuming &&
    props.disabledReason === undefined &&
    (session === undefined ||
      session.phase === "idle" ||
      session.phase === "running");
  const submitting = submittingDrafts.current.has(draftKey);
  const activeQuery = parseSuggestionQuery(draft, cursor);
  const queryKey = suggestionQueryKey(activeQuery);
  const composerCommands = runtime?.composerCommands ?? [];
  const commandSuggestions = useMemo(
    () =>
      activeQuery?.kind === "command"
        ? filterCommandSuggestions(
            composerCommands,
            activeQuery.query,
          )
        : [],
    [activeQuery?.kind, activeQuery?.query, composerCommands],
  );
  const fileSuggestions = useMemo<ComposerSuggestion[]>(
    () =>
      activeQuery?.kind === "file" && fileState.status === "ready"
        ? fileState.items.map((item) => ({
            kind: "file" as const,
            id: `file:${item.source}:${item.mention}`,
            ...item,
          }))
        : [],
    [activeQuery?.kind, fileState],
  );
  const suggestions =
    activeQuery?.kind === "file"
      ? fileSuggestions
      : commandSuggestions;
  const popupOpen =
    activeQuery !== null && dismissedQueryKey !== queryKey;
  const listboxId = `composer-suggestions-${draftKey}`;
  const visibleActiveIndex = activeIndex < suggestions.length ? activeIndex : 0;
  const activeSuggestion = suggestions[visibleActiveIndex];
  const suggestionIdentity = suggestions
    .map((suggestion) => suggestion.id)
    .join("\u0000");
  const contextSummary = readContextSummary(
    runtime?.contextStatus,
    runtime?.context,
  );
  const promptSuggestions = normalizePromptSuggestions(
    runtime?.promptSuggestions ?? [],
  );

  useEffect(() => setActiveIndex(0), [queryKey, suggestionIdentity]);

  useEffect(() => {
    requestSequence.current += 1;
    setError(null);
    setCursor(drafts.read(draftKey).length);
    setFileState({ status: "idle", items: [], truncated: false });
    setDismissedQueryKey(null);
  }, [draftKey, drafts]);

  useEffect(() => {
    if (activeQuery?.kind !== "file") {
      requestSequence.current += 1;
      setFileState({ status: "idle", items: [], truncated: false });
      return;
    }
    const sessionId = target.kind === "session" ? target.session.id : null;
    if (props.searchWorkspaceFiles === undefined || sessionId === null) {
      setFileState({ status: "failed", items: [], truncated: false });
      return;
    }
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    let active = true;
    setFileState({ status: "loading", items: [], truncated: false });
    const timeout = window.setTimeout(() => {
      void props
        .searchWorkspaceFiles?.(sessionId, activeQuery.query, controller.signal)
        .then(
          (result) => {
            if (!active || requestSequence.current !== sequence) return;
            setFileState({ status: "ready", ...result });
          },
          () => {
            if (
              !active ||
              controller.signal.aborted ||
              requestSequence.current !== sequence
            ) return;
            setFileState({ status: "failed", items: [], truncated: false });
          },
        );
    }, fileSuggestionDebounceMs);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    activeQuery?.kind,
    activeQuery?.query,
    props.searchWorkspaceFiles,
    draftKey,
    target.kind,
    target.kind === "home" ? null : target.session.id,
  ]);

  useLayoutEffect(() => {
    if (!restoreCaret.current) return;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(cursor, cursor);
    const frame = window.requestAnimationFrame(() => {
      restoreCaret.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cursor, draft]);

  function writeDraft(value: string): void {
    drafts.write(draftKey, value);
    setDraftRevision((revision) => revision + 1);
  }

  function clearDraft(key = draftKey): void {
    drafts.clear(key);
    if (key !== activeDraftKey.current) return;
    setDraftRevision((revision) => revision + 1);
    setCursor(0);
    setDismissedQueryKey(null);
  }

  function setDraftError(
    key: string,
    message: string | null,
  ): void {
    if (key === activeDraftKey.current) setError(message);
  }

  function checkRuntimeControl(control: RuntimeControl): boolean {
    if (target.kind !== "session") return false;
    const reason = runtimeControlReason(runtime, control);
    if (reason !== undefined) {
      setError(reason);
      return false;
    }
    setError(null);
    return true;
  }

  function focusRuntimeControl(
    control: "model" | "permission",
  ): boolean {
    if (!checkRuntimeControl(control)) return false;
    (control === "model" ? modelControl : permissionControl).current?.focus();
    return true;
  }

  function openMcp(): boolean {
    if (target.kind !== "session" || !checkRuntimeControl("mcp")) return false;
    target.openMcp();
    return true;
  }

  async function submitDraft(): Promise<void> {
    const text = draft.trim();
    if (
      !enabled ||
      text.length === 0 ||
      submittingDrafts.current.has(draftKey)
    ) return;
    const submittedKey = draftKey;
    submittingDrafts.current.add(submittedKey);
    setSubmissionRevision((revision) => revision + 1);
    try {
      if (target.kind === "home") {
        await target.start(text);
        setDraftError(submittedKey, null);
        clearDraft(submittedKey);
        return;
      }
      const completed = resolveCompletedCommand(text, composerCommands);
      if (completed !== undefined) {
        switch (completed.command.execution) {
          case "sdk-input":
            await target.send(text);
            setDraftError(submittedKey, null);
            clearDraft(submittedKey);
            return;
          case "model-control":
            if (focusRuntimeControl("model")) clearDraft(submittedKey);
            return;
          case "permission-control":
            if (focusRuntimeControl("permission")) clearDraft(submittedKey);
            return;
          case "mcp-control":
            if (openMcp()) clearDraft(submittedKey);
            return;
          case "context-control": {
            if (completed.argument.length > 0) {
              setError("/context 不接受参数。");
              return;
            }
            await target.refreshContext();
            setDraftError(submittedKey, null);
            clearDraft(submittedKey);
            return;
          }
        }
      }
      await target.send(text);
      setDraftError(submittedKey, null);
      clearDraft(submittedKey);
    } catch {
      setDraftError(submittedKey, "命令请求未能提交，请重试。");
    } finally {
      submittingDrafts.current.delete(submittedKey);
      setSubmissionRevision((revision) => revision + 1);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    void submitDraft();
  }

  function chooseSuggestion(suggestion: ComposerSuggestion): void {
    if (activeQuery === null) return;
    if (suggestion.kind === "command" && target.kind === "session") {
      const execution = suggestion.command.execution;
      if (
        execution === "model-control" ||
        execution === "permission-control" ||
        execution === "mcp-control"
      ) {
        const opened =
          execution === "model-control"
            ? focusRuntimeControl("model")
            : execution === "permission-control"
              ? focusRuntimeControl("permission")
              : openMcp();
        if (opened) clearDraft();
        return;
      }
    }
    const next = applySuggestion(draft, cursor, activeQuery, suggestion);
    restoreCaret.current = true;
    writeDraft(next.text);
    setCursor(next.cursor);
    if (
      suggestion.kind === "command" &&
      suggestion.command.execution !== "model-control" &&
      suggestion.command.execution !== "permission-control" &&
      suggestion.command.execution !== "mcp-control"
    ) {
      setDismissedQueryKey(
        suggestionQueryKey(parseSuggestionQuery(next.text, next.cursor)),
      );
    } else {
      setDismissedQueryKey(null);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && event.shiftKey) return;
    if (
      popupOpen &&
      activeSuggestion !== undefined &&
      (event.key === "Enter" || event.key === "Tab")
    ) {
      event.preventDefault();
      chooseSuggestion(activeSuggestion);
      return;
    }
    if (
      popupOpen &&
      suggestions.length > 0 &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (index) =>
          (index + direction + suggestions.length) % suggestions.length,
      );
      return;
    }
    if (popupOpen && event.key === "Escape") {
      event.preventDefault();
      setDismissedQueryKey(queryKey);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void submitDraft();
    }
  }

  return (
    <section
      className={`composer-wrap composer-${target.kind === "home" ? "hero" : "docked"}`}
      data-composer-variant={target.kind === "home" ? "hero" : "docked"}
      aria-label={copy.composer.region}
    >
      {(props.queued ?? []).length === 0 ? null : (
        <div className="queue-strip">
          {(props.queued ?? []).map((item) => (
            <span key={item.uuid}>
              <code>{item.uuid.slice(0, 8)}</code>{" "}
              {queuedStateLabel(item.state)}
              <button
                type="button"
                onClick={() =>
                  void props.cancel?.(item.uuid).catch(() =>
                    setDraftError(draftKey, copy.composer.alreadyProcessing),
                  )
                }
              >
                {copy.composer.cancelQueued}
              </button>
            </span>
          ))}
        </div>
      )}
      {error === null ? null : <p className="form-error">{error}</p>}
      {draft.length > 0 || promptSuggestions.length === 0 ? null : (
        <div className="composer-prompt-suggestions" aria-label="Prompt 建议">
          {promptSuggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              onClick={() => {
                writeDraft(suggestion);
                setCursor(suggestion.length);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {popupOpen ? (
        <ComposerSuggestionList
          id={listboxId}
          label={
            activeQuery?.kind === "file"
              ? copy.composer.fileSuggestions
              : copy.composer.commandSuggestions
          }
          items={suggestions}
          activeIndex={visibleActiveIndex}
          {...(activeQuery?.kind === "command" && suggestions.length === 0
            ? { statusMessage: copy.composer.noCommands }
            : activeQuery?.kind === "file" && fileState.status === "loading"
              ? { statusMessage: copy.composer.searchingFiles }
              : activeQuery?.kind === "file" && fileState.status === "failed"
                ? { statusMessage: copy.composer.fileSearchFailed }
                : activeQuery?.kind === "file" && fileState.status === "ready" && suggestions.length === 0
                  ? { statusMessage: copy.composer.noFiles }
                  : {})}
          truncated={fileState.truncated}
          truncatedMessage={copy.composer.filesTruncated}
          onHover={setActiveIndex}
          onSelect={chooseSuggestion}
        />
      ) : null}
      <form className="prompt-composer" onSubmit={submit}>
        <textarea
          ref={textarea}
          aria-label={copy.composer.message}
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          {...(popupOpen
            ? {
                "aria-controls": listboxId,
                ...(activeSuggestion === undefined
                  ? {}
                  : {
                      "aria-activedescendant": suggestionOptionId(
                        listboxId,
                        visibleActiveIndex,
                      ),
                    }),
              }
            : {})}
          value={draft}
          onChange={(event) => {
            writeDraft(event.currentTarget.value);
            setCursor(
              event.currentTarget.selectionStart ?? event.currentTarget.value.length,
            );
            setDismissedQueryKey(null);
          }}
          onClick={(event) =>
            restoreCaret.current
              ? undefined
              : setCursor(
                  event.currentTarget.selectionStart ??
                    event.currentTarget.value.length,
                )
          }
          onSelect={(event) =>
            restoreCaret.current
              ? undefined
              : setCursor(
                  event.currentTarget.selectionStart ??
                    event.currentTarget.value.length,
                )
          }
          onKeyDown={onKeyDown}
          placeholder={
            props.autoResuming
              ? copy.composer.restoringPlaceholder
              : props.disabledReason ??
                (enabled
                  ? copy.composer.placeholder
                  : copy.composer.resumePlaceholder)
          }
          disabled={!enabled || submitting}
        />
        <footer>
          {target.kind === "session" ? (
            <ComposerControlMenu
              key={target.session.id}
              context={contextSummary}
              {...(runtime === undefined ? {} : { runtime })}
              modelRef={modelControl}
              permissionRef={permissionControl}
              setModel={target.setModel}
              setPermissionMode={target.setPermissionMode}
              {...(target.modelFailure === undefined
                ? {}
                : { modelFailure: target.modelFailure })}
              {...(target.permissionFailure === undefined
                ? {}
                : { permissionFailure: target.permissionFailure })}
            />
          ) : null}
          {session?.phase === "running" ? (
            <button
              className="button danger"
              type="button"
              onClick={() => {
                if (target.kind === "session") {
                  void target.stop().catch(() =>
                    setDraftError(
                      draftKey,
                      "命令请求未能提交，请重试。",
                    ),
                  );
                }
              }}
            >
              {copy.composer.stop}
            </button>
          ) : null}
          <button
            className="button primary"
            type="submit"
            aria-keyshortcuts="Enter"
            disabled={!enabled || submitting || draft.trim().length === 0}
          >
            {copy.composer.send}
          </button>
        </footer>
      </form>
    </section>
  );
}
