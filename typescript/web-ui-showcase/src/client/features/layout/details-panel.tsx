import { SafeJson } from "../../components/safe-json.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { TaskDetails } from "../tasks/task-details.js";
import { SubagentDetails, type SubagentDetailsApi } from "./subagent-details.js";

type Accepted = { commandId: string };

export function DetailsPanel(props: {
  api: {
    stopTask(sessionId: string, taskId: string): Promise<Accepted>;
    backgroundTasks(sessionId: string, toolUseId?: string): Promise<Accepted>;
  } & SubagentDetailsApi;
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const selection = state.detailsSelection;
  const task = selection?.kind === "task"
    ? state.tasks[`${selection.sessionId}:${selection.taskId}`]
    : undefined;
  const interaction = selection?.kind === "approval"
    ? state.interactions[selection.interactionId]
    : undefined;
  const subagentTool = selection?.kind === "subagent"
    ? (state.messages[selection.sessionId] ?? []).find(
        (item) => item.kind === "tool" && item.toolUseId === selection.toolUseId,
      )
    : undefined;
  const label = selection?.kind === "task"
      ? copy.task.details
      : selection?.kind === "approval"
        ? copy.interaction.approvalDetails
        : selection?.kind === "subagent"
          ? copy.subagent.details
        : "详情";
  const title = subagentTool?.kind === "tool"
    ? subagentTool.name
    : task?.name ?? (interaction?.kind === "tool-approval"
      ? interaction.toolName
      : "详情");
  return (
    <aside
      className="details-region"
      aria-label={label}
    >
      {selection === null ? null : (
        <>
          <header className="details-panel-header">
            <strong>{title}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label={`关闭 ${label}`}
              onClick={() => store.closeDetails()}
            >
              ×
            </button>
          </header>
          <div className="details-panel-body">
            {selection.kind === "task" ? <TaskDetails stop={props.api.stopTask} background={props.api.backgroundTasks} /> : null}
            {selection.kind === "approval" ? (
              interaction === undefined ? <p className="details-empty">{copy.common.unavailable}</p> : (
                <div className="contextual-details approval-details">
                  <dl>
                    <div><dt>类型</dt><dd>{interaction.kind}</dd></div>
                    <div><dt>状态</dt><dd>{interaction.status}</dd></div>
                    <div><dt>请求时间</dt><dd><time dateTime={interaction.openedAt}>{interaction.openedAt}</time></dd></div>
                  </dl>
                  {interaction.kind === "tool-approval" ? <section><h4>Input</h4><SafeJson value={interaction.input} /></section> : null}
                </div>
              )
            ) : null}
            {selection.kind === "subagent" ? (
              subagentTool?.kind === "tool"
                ? <SubagentDetails tool={subagentTool} api={props.api} />
                : <p className="details-empty">{copy.subagent.unavailable}</p>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}
