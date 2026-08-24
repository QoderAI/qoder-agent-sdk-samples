import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ConversationItem } from "../../../shared/model.js";
import { EventBoundary } from "../errors/event-boundary.js";
import { MessageItem } from "./message-item.js";

export function MessageList(props: {
  sessionId: string;
  items: ConversationItem[];
  children?: ReactNode;
  onSelectAgent?: (
    item: Extract<ConversationItem, { kind: "tool" }>,
  ) => void;
  onCheckpoint?: (
    item: Extract<ConversationItem, { kind: "user" }>,
    trigger: HTMLButtonElement,
  ) => void;
}): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const previousSessionId = useRef(props.sessionId);
  useLayoutEffect(() => {
    if (previousSessionId.current !== props.sessionId) {
      previousSessionId.current = props.sessionId;
      followLatest.current = true;
    }
    const element = list.current;
    if (element !== null && followLatest.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [props.children, props.items, props.sessionId]);
  return (
    <div
      className="message-list conversation-scroll"
      data-testid="conversation-scroll"
      ref={list}
      onScroll={(event) => {
        const element = event.currentTarget;
        followLatest.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
      }}
    >
      {props.items.map((item) => (
        <EventBoundary key={item.id} fallbackPayload={item}>
          <MessageItem
            item={item}
            {...(props.onSelectAgent === undefined
              ? {}
              : { onSelectAgent: props.onSelectAgent })}
            {...(props.onCheckpoint === undefined
              ? {}
              : { onCheckpoint: props.onCheckpoint })}
          />
        </EventBoundary>
      ))}
      {props.children}
    </div>
  );
}
