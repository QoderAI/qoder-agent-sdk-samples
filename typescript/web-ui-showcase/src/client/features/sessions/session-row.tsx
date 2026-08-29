import { useEffect, useRef, useState } from "react";
import type { SessionView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import type { AcceptedCommand } from "../workspaces/workspace-panel.js";
import type { SessionActionApi } from "./session-actions.js";
import {
  SessionActionDialog,
  type SessionAcceptedAction,
  type SessionDialogAction,
} from "./session-action-dialog.js";
import { SessionMenu, type SessionMenuAction } from "./session-menu.js";

function formatRecency(updatedAt: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(updatedAt));
}

export function SessionRow(props: {
  session: SessionView;
  workspaceName: string;
  selected: boolean;
  onSelect: (sessionId: string) => void;
  api: SessionActionApi;
  onAccepted: (label: string, command: AcceptedCommand) => void;
}): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const store = useAppStore();
  const [dialog, setDialog] = useState<{
    action: SessionDialogAction;
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { session } = props;
  const recency = formatRecency(session.updatedAt);

  useEffect(() => {
    setDialog(null);
    setActionError(null);
  }, [session.id]);

  const chooseAction = (action: SessionMenuAction): void => {
    setActionError(null);
    if (action === "fork") {
      void props.api
        .forkSession(session.id, {})
        .then(
          (command) => {
            store.registerCommand(command.commandId, {
              surface: "session",
              control: "fork",
              sessionId: session.id,
            });
            props.onAccepted(copy.session.accepted.fork, command);
          },
          () => setActionError(copy.session.actionFailed),
        );
      return;
    }
    setDialog({
      action,
      returnFocus:
        row.current?.querySelector<HTMLElement>(
          ".session-row-action-trigger",
        ) ?? null,
    });
  };

  return (
    <div ref={row} className="session-row" data-selected={props.selected ? "true" : "false"} role="listitem">
      <button
        type="button"
        aria-label={`选择 Session：${session.title}，${props.workspaceName}，${recency}`}
        aria-current={props.selected ? "page" : undefined}
        className="session-item"
        onClick={() => props.onSelect(session.id)}
      >
        <span>{session.title}</span>
        <small>{props.workspaceName} · <time dateTime={session.updatedAt}>{recency}</time></small>
      </button>
      <div className="session-row-actions">
        <SessionMenu sessionTitle={session.title} onAction={chooseAction} />
      </div>
      <CommandFailureNotice owner={([
        "rename",
        "tag",
        "fork",
        "delete",
        "generate-title",
      ] as const).map((control) => ({
        surface: "session" as const,
        control,
        sessionId: session.id,
      }))} />
      {actionError === null ? null : <p className="form-error" role="alert">{actionError}</p>}
      {dialog === null ? null : (
        <SessionActionDialog
          action={dialog.action}
          session={session}
          api={props.api}
          returnFocus={dialog.returnFocus}
          onAccepted={(label, command, action: SessionAcceptedAction) => {
            store.registerCommand(command.commandId, {
              surface: "session",
              control: action,
              sessionId: session.id,
            });
            props.onAccepted(label, command);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
