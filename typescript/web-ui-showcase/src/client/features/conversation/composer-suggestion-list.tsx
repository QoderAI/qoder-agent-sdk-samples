import { useLayoutEffect, useRef } from "react";
import type { ComposerSuggestion } from "./composer-suggestions.js";

export function suggestionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

export function ComposerSuggestionList(props: {
  id: string;
  label: string;
  items: ComposerSuggestion[];
  activeIndex: number;
  statusMessage?: string;
  truncated?: boolean;
  truncatedMessage?: string;
  onHover: (index: number) => void;
  onSelect: (suggestion: ComposerSuggestion) => void;
}): JSX.Element {
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const activeId = props.items[props.activeIndex]?.id;
  useLayoutEffect(() => {
    if (activeId === undefined) return;
    optionRefs.current.get(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  return (
    <div className="composer-suggestions" id={props.id} role="listbox" aria-label={props.label}>
      {props.items.map((item, index) => (
        <button
          type="button"
          role="option"
          id={suggestionOptionId(props.id, index)}
          aria-selected={index === props.activeIndex}
          key={item.id}
          ref={(element) => {
            if (element === null) optionRefs.current.delete(item.id);
            else optionRefs.current.set(item.id, element);
          }}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => props.onHover(index)}
          onClick={() => props.onSelect(item)}
        >
          {item.kind === "command" ? (
            <>
              <span><strong>/{item.command.name}</strong>{item.command.argumentHint.length === 0 ? null : <code>{item.command.argumentHint}</code>}</span>
              {item.command.description.length === 0 ? null : <small>{item.command.description}</small>}
            </>
          ) : (
            <>
              <strong>@{item.path}</strong>
              <small>
                {item.rootLabel} · {item.source === "workspace" ? "Workspace" : "附加目录"}
              </small>
            </>
          )}
        </button>
      ))}
      {props.statusMessage === undefined ? null : (
        <p className="composer-suggestion-status">{props.statusMessage}</p>
      )}
      {props.truncated === true && props.truncatedMessage !== undefined ? (
        <small className="composer-suggestion-status">{props.truncatedMessage}</small>
      ) : null}
    </div>
  );
}
