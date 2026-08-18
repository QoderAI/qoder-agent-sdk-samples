import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  SelectablePermissionMode,
} from "../../../shared/commands.js";
import type { McpServerView, SessionRuntimeView } from "../../../shared/model.js";
import {
  runtimeRefreshCapability,
  type RuntimeCapabilityId,
} from "../../../shared/errors.js";
import { copy } from "../../i18n/zh-cn.js";
import type { CommandOwner } from "../../store/command-ownership.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import { McpPanel } from "../mcp/mcp-panel.js";
import { CreditsAccount } from "./credits-account.js";
import { ModelPicker } from "./model-picker.js";
import { PermissionPicker } from "./permission-picker.js";
import { useModalFocus } from "../layout/modal-focus.js";

export type RuntimeDialogSection =
  | "general"
  | "mcp"
  | "extensions"
  | "account";

type Accepted = { commandId: string };

export type RuntimeApi = {
  authenticateMcp(sessionId: string, name: string): Promise<Accepted>;
  submitMcpCallback(
    sessionId: string,
    name: string,
    url: string,
  ): Promise<Accepted>;
  reconnectMcp(sessionId: string, name: string): Promise<Accepted>;
  setModel(sessionId: string, model?: string): Promise<Accepted>;
  setPermissionMode(
    sessionId: string,
    mode: SelectablePermissionMode,
  ): Promise<Accepted>;
  addDirectories(sessionId: string, directories: string[]): Promise<Accepted>;
  refreshRuntime(sessionId: string): Promise<Accepted>;
  reloadPlugins(sessionId: string): Promise<Accepted>;
};

const sections: Array<{ id: RuntimeDialogSection; label: string }> = [
  { id: "general", label: "常规" },
  { id: "mcp", label: "MCP" },
  { id: "extensions", label: "Extensions" },
  { id: "account", label: "Account" },
];

function title(section: RuntimeDialogSection): string {
  switch (section) {
    case "general": return "常规设置";
    case "mcp": return "MCP";
    case "extensions": return "Extensions";
    case "account": return "Account";
  }
}

function recordLabel(record: Record<string, unknown>): string {
  for (const key of ["displayName", "name", "id", "model"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return copy.common.unavailable;
}

function runtimeError(
  runtime: SessionRuntimeView,
  capability: RuntimeCapabilityId,
): string | undefined {
  return runtime.errors.find((error) =>
    runtimeRefreshCapability(error) === capability
  )?.message;
}

function Extensions(props: {
  runtime: SessionRuntimeView;
  reloadPlugins(): Promise<Accepted>;
}): JSX.Element | null {
  return (
    <div className="runtime-section">
      <h3>Skills</h3>
      <p>{props.runtime.skills?.join(", ") || copy.common.unavailable}</p>
      <h3>Agents</h3>
      <p>{props.runtime.agents?.map(recordLabel).join(", ") || copy.common.unavailable}</p>
      <h3>Plugins</h3>
      <p>{props.runtime.plugins?.map(recordLabel).join(", ") || copy.common.unavailable}</p>
      <button
        className="button ghost"
        type="button"
        onClick={() => void props.reloadPlugins().catch(() => undefined)}
      >
        {copy.runtime.reloadPlugins}
      </button>
    </div>
  );
}

/** Hosts Session runtime controls in ordinary product settings. */
export function RuntimeDialog(props: {
  section: RuntimeDialogSection | null;
  sessionId: string | null;
  runtime?: SessionRuntimeView;
  servers: McpServerView[];
  api: RuntimeApi;
  onSectionChange(section: RuntimeDialogSection): void;
  onClose(): void;
}): JSX.Element | null {
  const [directory, setDirectory] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [pendingModel, setPendingModel] = useState<{
    commandId: string | null;
    requested: string | null;
  } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    commandId: string | null;
    requested: SelectablePermissionMode;
  } | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const store = useAppStore();
  const state = useAppState();
  const activeSessionId = props.sessionId;
  const section = props.section ?? "general";
  const runtime = props.runtime ?? {
    sessionId: props.sessionId ?? "00000000-0000-4000-8000-000000000000",
    currentModel: null,
    currentPermissionMode: "default",
    capabilities: [],
    hooks: [],
    rawEvents: [],
    errors: [],
  };
  const modelReason = runtimeError(runtime, "models");
  const permissionReason = runtimeError(runtime, "permission");
  const track = useCallback(
    async (
      request: Promise<Accepted>,
      control: Extract<CommandOwner, { surface: "runtime" }>["control"],
      sessionId: string,
    ): Promise<Accepted> => {
      setSubmissionError(null);
      try {
        const accepted = await request;
        store.registerCommand(accepted.commandId, {
          surface: "runtime",
          control,
          sessionId,
        });
        return accepted;
      } catch (error) {
        setSubmissionError(copy.error.controlSubmitFailed);
        throw error;
      }
    },
    [store],
  );

  useEffect(() => {
    if (props.section === null) {
      setSubmissionError(null);
      setPendingModel(null);
      setPendingPermission(null);
    }
  }, [props.section]);

  useEffect(() => {
    if (
      pendingModel !== null &&
      (runtime.currentModel === pendingModel.requested ||
        (pendingModel.commandId !== null && state.commandFailures.some(
          (failure) => failure.commandId === pendingModel.commandId,
        )))
    ) {
      setPendingModel(null);
    }
  }, [pendingModel, runtime.currentModel, state.commandFailures]);

  useEffect(() => {
    if (
      pendingPermission !== null &&
      (runtime.currentPermissionMode === pendingPermission.requested ||
        (pendingPermission.commandId !== null && state.commandFailures.some(
          (failure) => failure.commandId === pendingPermission.commandId,
        )))
    ) {
      setPendingPermission(null);
    }
  }, [pendingPermission, runtime.currentPermissionMode, state.commandFailures]);

  async function setModel(model?: string): Promise<Accepted> {
    const requested = model ?? null;
    setPendingModel({ commandId: null, requested });
    try {
      const accepted = await track(
        props.api.setModel(activeSessionId as string, model),
        "model",
        activeSessionId as string,
      );
      setPendingModel((current) =>
        current?.requested === requested
          ? { commandId: accepted.commandId, requested }
          : current,
      );
      return accepted;
    } catch (error) {
      setPendingModel(null);
      throw error;
    }
  }

  async function setPermissionMode(
    mode: SelectablePermissionMode,
  ): Promise<Accepted> {
    setPendingPermission({ commandId: null, requested: mode });
    try {
      const accepted = await track(
        props.api.setPermissionMode(activeSessionId as string, mode),
        "permission",
        activeSessionId as string,
      );
      setPendingPermission((current) =>
        current?.requested === mode
          ? { commandId: accepted.commandId, requested: mode }
          : current,
      );
      return accepted;
    } catch (error) {
      setPendingPermission(null);
      throw error;
    }
  }

  useEffect(() => {
    if (
      props.sessionId === null ||
      (props.section !== "account" && props.section !== "extensions")
    ) {
      return;
    }
    void track(
      props.api.refreshRuntime(props.sessionId),
      props.section === "account"
        ? "refresh-account"
        : "refresh-extensions",
      props.sessionId,
    ).catch(() => undefined);
  }, [props.api, props.section, props.sessionId, track]);

  useModalFocus({
    open: props.section !== null,
    dialogRef: dialog,
    initialFocusRef: closeButton,
    onClose: props.onClose,
  });

  function addDirectory(event: FormEvent): void {
    event.preventDefault();
    const value = directory.trim();
    if (activeSessionId === null || value.length === 0) return;
    void track(
      props.api.addDirectories(activeSessionId, [value]),
      "directory",
      activeSessionId,
    ).then(
      () => setDirectory(""),
      () => undefined,
    );
  }

  let content: JSX.Element;
  if (activeSessionId === null) {
    content = <p>{copy.runtime.selectSession}</p>;
  } else {
    switch (section) {
      case "general":
        content = (
          <div className="runtime-section runtime-general">
            <ModelPicker
              models={runtime.models}
              value={runtime.currentModel}
              pending={pendingModel !== null}
              setModel={setModel}
              {...(modelReason === undefined
                ? {}
                : { disabledReason: modelReason })}
            />
            <CommandFailureNotice owner={{ surface: "runtime", control: "model", sessionId: activeSessionId }} />
            <PermissionPicker
              value={runtime.currentPermissionMode}
              pending={pendingPermission !== null}
              setPermission={setPermissionMode}
              {...(permissionReason === undefined
                ? {}
                : { disabledReason: permissionReason })}
            />
            <CommandFailureNotice owner={{ surface: "runtime", control: "permission", sessionId: activeSessionId }} />
            <form onSubmit={addDirectory}>
              <label>
                {copy.runtime.additionalDirectory}
                <input value={directory} onChange={(event) => setDirectory(event.currentTarget.value)} />
              </label>
              <button className="button ghost" type="submit" disabled={directory.trim().length === 0}>
                {copy.runtime.addDirectory}
              </button>
            </form>
            <CommandFailureNotice owner={{ surface: "runtime", control: "directory", sessionId: activeSessionId }} />
            {(runtime.allowedDirectories ?? []).length === 0 ? null : (
              <ul aria-label="已允许目录">
                {runtime.allowedDirectories?.map((path) => <li key={path}>{path}</li>)}
              </ul>
            )}
          </div>
        );
        break;
      case "mcp":
        content = (
          <>
            <CommandFailureNotice owner={{ surface: "runtime", control: "mcp", sessionId: activeSessionId }} />
            <McpPanel
              servers={props.servers}
              authenticate={(name) =>
                track(props.api.authenticateMcp(activeSessionId, name), "mcp", activeSessionId)
              }
              submitCallback={(name, url) =>
                track(
                  props.api.submitMcpCallback(activeSessionId, name, url),
                  "mcp",
                  activeSessionId,
                )
              }
              reconnect={(name) =>
                track(props.api.reconnectMcp(activeSessionId, name), "mcp", activeSessionId)
              }
            />
          </>
        );
        break;
      case "extensions":
        content = (
          <>
            <CommandFailureNotice owner={[
              { surface: "runtime", control: "refresh-extensions", sessionId: activeSessionId },
              { surface: "runtime", control: "plugins", sessionId: activeSessionId },
            ]} />
            <Extensions
              runtime={runtime}
              reloadPlugins={() =>
                track(props.api.reloadPlugins(activeSessionId), "plugins", activeSessionId)
              }
            />
          </>
        );
        break;
      case "account":
        content = (
          <>
            <CommandFailureNotice owner={{ surface: "runtime", control: "refresh-account", sessionId: activeSessionId }} />
            <CreditsAccount account={runtime.account} credits={runtime.credits} />
          </>
        );
        break;
    }
  }

  if (props.section === null) return null;
  const dialogTitle = title(section);
  return (
    <div className="runtime-dialog-backdrop" onMouseDown={props.onClose}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={dialogTitle}
        className="runtime-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <nav className="runtime-tabs" aria-label="设置分区">
          <strong>设置</strong>
          {sections.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              aria-selected={section === candidate.id}
              onClick={() => props.onSectionChange(candidate.id)}
            >
              {candidate.label}
            </button>
          ))}
        </nav>
        <div className="runtime-dialog-content">
          <header>
            <strong>{dialogTitle}</strong>
            <button ref={closeButton} type="button" className="icon-button" aria-label={`${copy.common.close} ${dialogTitle}`} onClick={props.onClose}>×</button>
          </header>
          <div className="runtime-dialog-body">
            {submissionError === null ? null : (
              <p className="form-error" role="alert">
                <strong>{copy.error.controlFailed}</strong>{" "}
                {submissionError}
              </p>
            )}
            {content}
          </div>
        </div>
      </section>
    </div>
  );
}
