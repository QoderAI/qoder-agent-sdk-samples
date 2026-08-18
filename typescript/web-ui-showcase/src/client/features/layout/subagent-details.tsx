import { useEffect, useState } from "react";
import type { ConversationItem } from "../../../shared/model.js";
import type { SubagentTranscriptResponse } from "../../../shared/subagents.js";
import { copy, toolLifecycleLabel } from "../../i18n/zh-cn.js";
import { MessageItem } from "../conversation/message-item.js";
import { ToolCard } from "../conversation/tool-card.js";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;
type LoadState =
  | { status: "loading" }
  | { status: "waiting" }
  | { status: "ready"; response: Extract<SubagentTranscriptResponse, { status: "ready" }> }
  | { status: "error" };

export type SubagentDetailsApi = {
  getSubagentTranscript(
    sessionId: string,
    toolUseId: string,
    signal?: AbortSignal,
  ): Promise<SubagentTranscriptResponse>;
};

function isRunning(tool: ToolItem): boolean {
  return tool.lifecycle === "requested" || tool.lifecycle === "running";
}

function TranscriptItem(props: { item: ConversationItem }): JSX.Element | null {
  if (props.item.kind === "user") {
    return (
      <article className="subagent-instruction" aria-label={copy.subagent.instruction}>
        <strong>{copy.subagent.instruction}</strong>
        <p>{props.item.text}</p>
      </article>
    );
  }
  if (props.item.kind === "tool") {
    return <ToolCard item={props.item} agentBehavior="inline" />;
  }
  return <MessageItem item={props.item} />;
}

export function SubagentDetails(props: {
  tool: ToolItem;
  api: SubagentDetailsApi;
}): JSX.Element {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const live = isRunning(props.tool);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    setLoadState({ status: "loading" });

    const load = async (): Promise<void> => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await props.api.getSubagentTranscript(
          props.tool.sessionId,
          props.tool.toolUseId,
          controller.signal,
        );
        if (!active) return;
        setLoadState(response.status === "ready"
          ? { status: "ready", response }
          : { status: "waiting" });
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setLoadState({ status: "error" });
      }
      if (active && live) {
        timer = window.setTimeout(() => void load(), 1_000);
      }
    };

    void load();
    return () => {
      active = false;
      controller?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [attempt, live, props.api, props.tool.sessionId, props.tool.toolUseId]);

  return (
    <div className="contextual-details subagent-details">
      <dl>
        <div><dt>类型</dt><dd>Agent</dd></div>
        <div><dt>状态</dt><dd>{toolLifecycleLabel(props.tool.lifecycle)}</dd></div>
        {props.tool.durationMs === undefined ? null : (
          <div><dt>耗时</dt><dd>{props.tool.durationMs} ms</dd></div>
        )}
      </dl>
      <section className="subagent-transcript" aria-label="Subagent 执行记录">
        {loadState.status === "loading" ? <p>{copy.subagent.loading}</p> : null}
        {loadState.status === "waiting" ? (
          <div className="details-empty">
            <p>{live ? copy.subagent.waiting : copy.subagent.unavailable}</p>
            {live ? null : <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>{copy.subagent.retry}</button>}
          </div>
        ) : null}
        {loadState.status === "error" ? (
          <div className="details-empty">
            <p>{copy.subagent.loadFailed}</p>
            <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>{copy.subagent.retry}</button>
          </div>
        ) : null}
        {loadState.status === "ready" && loadState.response.items.length === 0
          ? <p className="details-empty">{copy.subagent.empty}</p>
          : null}
        {loadState.status === "ready"
          ? loadState.response.items.map((item) => (
              <TranscriptItem key={item.id} item={item} />
            ))
          : null}
      </section>
    </div>
  );
}
