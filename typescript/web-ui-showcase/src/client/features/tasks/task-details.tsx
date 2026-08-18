import { useState } from "react";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";

type Accepted = { commandId: string };

/** Renders the latest Task state and only the controls valid for that state. */
export function TaskDetails(props: {
  stop: (sessionId: string, taskId: string) => Promise<Accepted>;
  background: (sessionId: string, toolUseId?: string) => Promise<Accepted>;
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const [actionError, setActionError] = useState<string | null>(null);
  const selection = state.detailsSelection;
  const task =
    selection?.kind === "task"
      ? state.tasks[`${selection.sessionId}:${selection.taskId}`]
      : undefined;
  if (task === undefined) {
    return <p className="details-empty">{copy.common.unavailable}</p>;
  }
  const active = task.status === "running";
  const run = async (
    request: Promise<Accepted>,
    control: "stop" | "background",
  ): Promise<void> => {
    setActionError(null);
    try {
      const accepted = await request;
      store.registerCommand(accepted.commandId, {
        surface: "task",
        control,
        sessionId: task.sessionId,
        resourceId: task.taskId,
      });
    } catch {
      setActionError(copy.task.actionFailed);
    }
  };
  return (
    <div className="contextual-details task-details">
      <dl>
        <div><dt>状态</dt><dd>{task.status}</dd></div>
        <div><dt>运行位置</dt><dd>{task.foreground ? copy.task.foreground : copy.task.background}</dd></div>
        <div><dt>进度</dt><dd>{task.progress === undefined ? "—" : `${Math.round(task.progress * 100)}%`}</dd></div>
        <div><dt>耗时</dt><dd>{task.elapsedMs === undefined ? "—" : `${task.elapsedMs} ms`}</dd></div>
      </dl>
      {task.error === undefined ? null : (
        <p className="error-text">{task.error.message}</p>
      )}
      {actionError === null ? null : (
        <p className="form-error" role="alert">{actionError}</p>
      )}
      <CommandFailureNotice owner={([
        "stop",
        "background",
      ] as const).map((control) => ({
        surface: "task" as const,
        control,
        sessionId: task.sessionId,
        resourceId: task.taskId,
      }))} />
      {active ? (
        <div className="details-actions">
          <button
            type="button"
            className="button danger"
            onClick={() => void run(
              props.stop(task.sessionId, task.taskId),
              "stop",
            )}
          >
            {copy.task.stop}
          </button>
          {task.foreground ? (
            <button
              type="button"
              className="button ghost"
              onClick={() =>
                void run(
                  props.background(task.sessionId, task.toolUseId),
                  "background",
                )
              }
            >
              {copy.task.moveBackground}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
