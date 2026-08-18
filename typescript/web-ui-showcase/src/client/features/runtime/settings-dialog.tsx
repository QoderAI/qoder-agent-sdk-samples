import { useEffect, useRef, useState } from "react";
import type { SelectablePermissionMode } from "../../../shared/commands.js";
import type { SessionRuntimeView } from "../../../shared/model.js";
import {
  runtimeRefreshCapability,
  type RuntimeCapabilityId,
} from "../../../shared/errors.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import { useModalFocus } from "../layout/modal-focus.js";
import { ModelPicker } from "./model-picker.js";
import { PermissionPicker } from "./permission-picker.js";
import { useRuntimeTrack } from "./use-runtime-track.js";

type Accepted = { commandId: string };

export type SettingsApi = {
  setModel(sessionId: string, model?: string): Promise<Accepted>;
  setPermissionMode(
    sessionId: string,
    mode: SelectablePermissionMode,
  ): Promise<Accepted>;
  pickAndAddDirectory(sessionId: string): Promise<Accepted>;
};

function runtimeError(
  runtime: SessionRuntimeView,
  capability: RuntimeCapabilityId,
): string | undefined {
  return runtime.errors.find((error) =>
    runtimeRefreshCapability(error) === capability,
  )?.message;
}

/** Hosts Session runtime controls in ordinary product settings. */
export function SettingsDialog(props: {
  open: boolean;
  sessionId: string | null;
  runtime?: SessionRuntimeView;
  api: SettingsApi;
  onClose(): void;
}): JSX.Element | null {
  const [pendingModel, setPendingModel] = useState<{
    commandId: string | null;
    requested: string | null;
  } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    commandId: string | null;
    requested: SelectablePermissionMode;
  } | null>(null);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const state = useAppState();
  const { track, submissionError, clearSubmissionError } = useRuntimeTrack();
  const activeSessionId = props.sessionId;
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

  useEffect(() => {
    if (!props.open) {
      clearSubmissionError();
      setPendingModel(null);
      setPendingPermission(null);
    }
  }, [props.open, clearSubmissionError]);

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

  useModalFocus({
    open: props.open,
    dialogRef: dialog,
    initialFocusRef: closeButton,
    onClose: props.onClose,
  });

  async function setModel(model?: string): Promise<Accepted> {
    if (activeSessionId === null) throw new Error("no active session");
    const requested = model ?? null;
    setPendingModel({ commandId: null, requested });
    try {
      const accepted = await track(
        props.api.setModel(activeSessionId, model),
        "model",
        activeSessionId,
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
    if (activeSessionId === null) throw new Error("no active session");
    setPendingPermission({ commandId: null, requested: mode });
    try {
      const accepted = await track(
        props.api.setPermissionMode(activeSessionId, mode),
        "permission",
        activeSessionId,
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

  function addDirectory(): void {
    if (activeSessionId === null) return;
    setPickingDirectory(true);
    void track(
      props.api.pickAndAddDirectory(activeSessionId),
      "directory",
      activeSessionId,
    ).then(
      () => setPickingDirectory(false),
      () => setPickingDirectory(false),
    );
  }

  if (!props.open) return null;
  return (
    <div className="runtime-dialog-backdrop" onMouseDown={props.onClose}>
      <section
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="runtime-dialog settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="runtime-dialog-content">
          <header>
            <strong>设置</strong>
            <button ref={closeButton} type="button" className="icon-button" aria-label={`${copy.common.close} 设置`} onClick={props.onClose}>×</button>
          </header>
          <div className="runtime-dialog-body">
            {submissionError === null ? null : (
              <p className="form-error" role="alert">
                <strong>{copy.error.controlFailed}</strong> {submissionError}
              </p>
            )}
            {activeSessionId === null ? (
              <p>{copy.runtime.selectSession}</p>
            ) : (
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
                <div className="settings-directory-row">
                  <strong>{copy.runtime.additionalDirectory}</strong>
                  <button
                    className="button ghost"
                    type="button"
                    disabled={pickingDirectory}
                    onClick={addDirectory}
                  >
                    {copy.runtime.addDirectory}
                  </button>
                </div>
                <CommandFailureNotice owner={{ surface: "runtime", control: "directory", sessionId: activeSessionId }} />
                {(runtime.allowedDirectories ?? []).length === 0 ? null : (
                  <ul aria-label="已允许目录">
                    {runtime.allowedDirectories?.map((path) => <li key={path}>{path}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
