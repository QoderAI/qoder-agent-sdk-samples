import type { SessionView, WorkspaceView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import type { AcceptedCommand } from "../workspaces/workspace-panel.js";
import { WorkspacePanel } from "../workspaces/workspace-panel.js";
import type { SessionActionApi } from "../sessions/session-actions.js";
import { SessionTree } from "../sessions/session-tree.js";

export function AppSidebar(props: {
  collapsed: boolean;
  workspaces: WorkspaceView[];
  sessions: SessionView[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onNewSessionInWorkspace: (workspaceId: string) => void;
  onOpenSettings: () => void;
  onOpenSdkConsole: () => void;
  onToggle: () => void;
  api: SessionActionApi & {
    pickWorkspace(): Promise<AcceptedCommand>;
  };
  onAccepted: (label: string, command: AcceptedCommand) => void;
}): JSX.Element {
  return (
    <aside className="workspace-region" aria-label={copy.workspace.navigation}>
      <header className="brand-block">
        <span className="brand-mark">Q</span>
        <div className="sidebar-wide"><strong>Qoder SDK 样板</strong><small>本地项目 Agent</small></div>
        <button className="sidebar-icon-button sidebar-toggle" type="button" aria-label={props.collapsed ? "展开 Session 侧栏" : "收起 Session 侧栏"} onClick={props.onToggle}>
          {props.collapsed ? "›" : "‹"}
        </button>
      </header>
      <div className="sidebar-wide sidebar-browser">
        <WorkspacePanel
          pickWorkspace={() => props.api.pickWorkspace()}
          onNewSession={props.onNewSession}
          onAccepted={props.onAccepted}
        />
        <SessionTree
          workspaces={props.workspaces}
          sessions={props.sessions}
          selectedSessionId={props.selectedSessionId}
          onSelect={props.onSelectSession}
          onNewSessionInWorkspace={props.onNewSessionInWorkspace}
          api={props.api}
          onAccepted={props.onAccepted}
        />
      </div>
      <button className="sidebar-foot-action sidebar-settings" type="button" aria-label="设置" onClick={props.onOpenSettings}>
        <span aria-hidden="true">⚙</span><span className="sidebar-wide">设置</span>
      </button>
      <button className="sidebar-foot-action" type="button" aria-label="SDK 控制台" onClick={props.onOpenSdkConsole}>
        <span aria-hidden="true">⌘</span><span className="sidebar-wide">SDK 控制台</span>
      </button>
    </aside>
  );
}
