import { useState } from "react";
import type { ConversationItem } from "../../../shared/model.js";
import { toolLifecycleLabel } from "../../i18n/zh-cn.js";
import { ToolDetails } from "./tool-details.js";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

export function ToolCard(props: {
  item: ToolItem;
  agentBehavior?: "details" | "inline";
  onSelectAgent?: (item: ToolItem) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const status = toolLifecycleLabel(props.item.lifecycle);
  const opensAgentDetails =
    props.item.name === "Agent" &&
    props.agentBehavior !== "inline" &&
    props.onSelectAgent !== undefined;
  return (
    <article className="tool-card">
      <button
        type="button"
        className="tool-row"
        aria-label={`${props.item.name} · ${status}`}
        aria-expanded={opensAgentDetails ? undefined : expanded}
        onClick={() => {
          if (opensAgentDetails) props.onSelectAgent?.(props.item);
          else setExpanded((current) => !current);
        }}
      >
        <span className="tool-row-icon" aria-hidden="true">›</span>
        <strong>{props.item.name}</strong>
        <span className={`status-pill ${props.item.lifecycle}`}>{status}</span>
        {props.item.durationMs === undefined ? null : (
          <small>{props.item.durationMs} ms</small>
        )}
      </button>
      {!opensAgentDetails && expanded ? (
        <section
          className="tool-inline-details"
          aria-label={`${props.item.name} Tool 详情`}
        >
          <ToolDetails item={props.item} />
        </section>
      ) : null}
    </article>
  );
}
