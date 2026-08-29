import type { ConversationItem } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { ToolCard } from "./tool-card.js";

function assertNever(value: never): never {
  throw new Error(`Unknown conversation item: ${JSON.stringify(value)}`);
}

export function MessageItem(props: {
  item: ConversationItem;
  onSelectAgent?: (
    item: Extract<ConversationItem, { kind: "tool" }>,
  ) => void;
  onCheckpoint?: (
    item: Extract<ConversationItem, { kind: "user" }>,
    trigger: HTMLButtonElement,
  ) => void;
}): JSX.Element | null {
  const { item } = props;
  switch (item.kind) {
    case "user":
      return (
        <article className="message-card user" aria-label={copy.conversation.userMessage}>
          <p>{item.text}</p>
          {props.onCheckpoint === undefined ? null : (
            <div className="message-actions">
              <button
                type="button"
                className="message-action"
                onClick={(event) =>
                  props.onCheckpoint?.(item, event.currentTarget)
                }
              >
                {copy.checkpoint.action}
              </button>
            </div>
          )}
        </article>
      );
    case "assistant": {
      const streaming = item.status === "streaming";
      return <article className="message-card assistant" aria-label={copy.conversation.assistantMessage}><p aria-live={streaming ? "polite" : undefined}>{item.text}</p>{streaming ? <span className="streaming-dot" aria-label="streaming" /> : null}{item.status === "interrupted" ? <small className="message-status">{copy.conversation.interrupted}</small> : null}{item.status === "failed" ? <small className="message-status error-text">{copy.conversation.failed}</small> : null}</article>;
    }
    case "tool":
      return (
        <ToolCard
          item={item}
          {...(props.onSelectAgent === undefined
            ? {}
            : { onSelectAgent: props.onSelectAgent })}
        />
      );
    case "progress":
      return <article className="message-card progress" aria-label={copy.conversation.progress}><strong>{item.label}</strong>{item.detail === undefined ? null : <p>{item.detail}</p>}</article>;
    case "error":
      return <article className="message-card error" aria-label={copy.conversation.sdkError}><strong>{item.error.code}</strong><p>{item.error.message}</p></article>;
    default:
      return assertNever(item);
  }
}
