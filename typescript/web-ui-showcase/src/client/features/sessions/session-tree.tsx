import { useState } from "react";
import type { SessionView, WorkspaceView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import type { AcceptedCommand } from "../workspaces/workspace-panel.js";
import type { SessionActionApi } from "./session-actions.js";
import { SessionRow } from "./session-row.js";

export function SessionTree(props: {
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  api: SessionActionApi;
  onAccepted: (label: string, command: AcceptedCommand) => void;
}): JSX.Element {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return (
    <div className="session-tree">
      <label className="session-search">
        <span>{copy.session.search}</span>
        <input aria-label={copy.session.search} value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder={copy.session.search} />
      </label>
      {props.workspaces.map((workspace) => {
        const sessions = props.sessions
          .filter(
            (session) =>
              session.workspaceId === workspace.id &&
              (normalizedSearch.length === 0 ||
                session.title.toLocaleLowerCase().includes(normalizedSearch)),
          )
          .sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
          );
        return (
          <details key={workspace.id} className="workspace-group" open>
            <summary className="workspace-heading">
              <div>
                <strong>{workspace.displayName}</strong>
                <small title={workspace.path}>{workspace.path}</small>
              </div>
            </summary>
            <div role="list" aria-label={`${workspace.displayName} 的 Sessions`}>
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  workspaceName={workspace.displayName}
                  selected={props.selectedSessionId === session.id}
                  onSelect={props.onSelect}
                  api={props.api}
                  onAccepted={props.onAccepted}
                />
              ))}
            </div>
            {sessions.length === 0 ? <p className="empty-note">{copy.session.none}</p> : null}
          </details>
        );
      })}
    </div>
  );
}
