import { useEffect, useState, type Ref } from "react";
import type { SelectablePermissionMode } from "../../../shared/commands.js";
import type { SessionRuntimeView } from "../../../shared/model.js";
import {
  runtimeRefreshCapability,
  type RuntimeCapabilityId,
} from "../../../shared/errors.js";
import type { ContextSummary } from "./context-summary.js";
import { ModelPicker } from "../runtime/model-picker.js";
import { PermissionPicker } from "../runtime/permission-picker.js";

export type RuntimeControlFailure = {
  commandId?: string;
  message: string;
  dismiss?(): void;
};

export type RuntimeControl = "model" | "permission" | "mcp";

export function runtimeControlReason(
  runtime: SessionRuntimeView | undefined,
  control: RuntimeControl,
): string | undefined {
  const capability: RuntimeCapabilityId =
    control === "model"
      ? "models"
      : control === "permission"
        ? "permission"
        : "mcp";
  return runtime?.errors.find((error) =>
    runtimeRefreshCapability(error) === capability
  )?.message;
}

/** Session-scoped controls available from the shared Composer. */
export function ComposerControlMenu(props: {
  context: ContextSummary | null;
  runtime?: SessionRuntimeView;
  modelRef: Ref<HTMLSelectElement>;
  permissionRef: Ref<HTMLSelectElement>;
  setModel(model?: string): Promise<{ commandId: string }>;
  setPermissionMode(
    mode: SelectablePermissionMode,
  ): Promise<{ commandId: string }>;
  modelFailure?: RuntimeControlFailure;
  permissionFailure?: RuntimeControlFailure;
}): JSX.Element {
  const modelReason = runtimeControlReason(props.runtime, "model");
  const permissionReason = runtimeControlReason(props.runtime, "permission");
  const [pendingModel, setPendingModel] = useState<{
    commandId: string | null;
    requested: string | null;
  } | null>(null);
  const [pendingPermission, setPendingPermission] = useState<{
    commandId: string | null;
    requested: SelectablePermissionMode;
  } | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const runtime = props.runtime;

  useEffect(() => {
    if (
      pendingModel !== null &&
      (runtime?.currentModel === pendingModel.requested ||
        (pendingModel.commandId !== null &&
          props.modelFailure?.commandId === pendingModel.commandId))
    ) {
      setPendingModel(null);
    }
  }, [pendingModel, props.modelFailure?.commandId, runtime?.currentModel]);

  useEffect(() => {
    if (
      pendingPermission !== null &&
      (runtime?.currentPermissionMode === pendingPermission.requested ||
        (pendingPermission.commandId !== null &&
          props.permissionFailure?.commandId === pendingPermission.commandId))
    ) {
      setPendingPermission(null);
    }
  }, [
    pendingPermission,
    props.permissionFailure?.commandId,
    runtime?.currentPermissionMode,
  ]);

  async function setModel(model?: string): Promise<{ commandId: string }> {
    const requested = model ?? null;
    props.modelFailure?.dismiss?.();
    setSubmissionError(null);
    setPendingModel({ commandId: null, requested });
    try {
      const accepted = await props.setModel(model);
      setPendingModel((current) =>
        current?.requested === requested
          ? { commandId: accepted.commandId, requested }
          : current);
      return accepted;
    } catch (error) {
      setPendingModel(null);
      setSubmissionError("无法提交 Model 设置，请重试。");
      throw error;
    }
  }

  async function setPermissionMode(
    mode: SelectablePermissionMode,
  ): Promise<{ commandId: string }> {
    props.permissionFailure?.dismiss?.();
    setSubmissionError(null);
    setPendingPermission({ commandId: null, requested: mode });
    try {
      const accepted = await props.setPermissionMode(mode);
      setPendingPermission((current) =>
        current?.requested === mode
          ? { commandId: accepted.commandId, requested: mode }
          : current);
      return accepted;
    } catch (error) {
      setPendingPermission(null);
      setSubmissionError("无法提交 Permission Mode 设置，请重试。");
      throw error;
    }
  }

  return (
    <div className="runtime-control-stack">
      <div className="runtime-controls" aria-label="Composer 控制">
        <ModelPicker
          className="composer-runtime-select"
          label="Model"
          selectRef={props.modelRef}
          models={runtime?.models}
          value={runtime?.currentModel ?? null}
          pending={pendingModel !== null}
          setModel={setModel}
          {...(modelReason === undefined ? {} : { disabledReason: modelReason })}
        />
        <PermissionPicker
          className="composer-runtime-select"
          label="Permission Mode"
          selectRef={props.permissionRef}
          value={runtime?.currentPermissionMode ?? "default"}
          pending={pendingPermission !== null}
          setPermission={setPermissionMode}
          {...(permissionReason === undefined
            ? {}
            : { disabledReason: permissionReason })}
        />
        {props.context === null ? null : (
          <span className="context-meter" title={props.context.title}>
            {props.context.label}
          </span>
        )}
      </div>
      {submissionError === null ? null : (
        <p className="form-error">{submissionError}</p>
      )}
      {props.modelFailure === undefined &&
      props.permissionFailure === undefined ? null : (
        <p className="form-error command-failure" role="alert">
          <span>{props.modelFailure?.message ?? props.permissionFailure?.message}</span>
          {(props.modelFailure ?? props.permissionFailure)?.dismiss === undefined
            ? null
            : (
              <button
                type="button"
                className="icon-button"
                aria-label="关闭操作错误"
                onClick={() =>
                  (props.modelFailure ?? props.permissionFailure)?.dismiss?.()}
              >
                ×
              </button>
            )}
        </p>
      )}
    </div>
  );
}
