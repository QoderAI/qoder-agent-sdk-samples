import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import type {
  SessionStarted,
  StartSessionCommand,
} from "../../../shared/commands.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import type { AcceptedCommand } from "../workspaces/workspace-panel.js";
import { WorkspacePanel } from "../workspaces/workspace-panel.js";
import type { SessionActionApi } from "../sessions/session-actions.js";
import { SessionTree } from "../sessions/session-tree.js";
import type { ConversationApi } from "../conversation/conversation-panel.js";
import { ConversationRoot } from "../conversation/conversation-root.js";
import { SdkConsole } from "../sdk-console/sdk-console.js";
import { ErrorBanner } from "../errors/error-banner.js";
import { useSessionSelection } from "../sessions/use-session-selection.js";
import { copy } from "../../i18n/zh-cn.js";
import { AppSidebar } from "./app-sidebar.js";
import { computeColumns } from "./columns.js";
import { Drawer } from "./drawer.js";
import { DetailsPanel } from "./details-panel.js";
import {
  RuntimeDialog,
  type RuntimeApi,
} from "../runtime/runtime-dialog.js";

export type ShellApi = SessionActionApi & ConversationApi & RuntimeApi & {
  pickWorkspace(): Promise<AcceptedCommand>;
  registerWorkspace(input: { path: string }): Promise<AcceptedCommand>;
  startSession(input: StartSessionCommand): Promise<SessionStarted>;
  ensureSession(sessionId: string): Promise<AcceptedCommand>;
};

export function AppShell(props: {
  api: ShellApi;
  realtime: {
    selectSession(sessionId: string | null): void;
    reloadSnapshot?(): void;
  };
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [projectDrawer, setProjectDrawer] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const workspaces = state.workspaceIds.flatMap((id) =>
    state.workspaces[id] === undefined ? [] : [state.workspaces[id]],
  );
  const sessions = state.sessionIds.flatMap((id) =>
    state.sessions[id] === undefined ? [] : [state.sessions[id]],
  );
  const selected =
    state.selectedSessionId === null
      ? undefined
      : state.sessions[state.selectedSessionId];
  const selectRealtimeSession = useCallback(
    (sessionId: string | null) => props.realtime.selectSession(sessionId),
    [props.realtime],
  );
  const ensureSession = useCallback(
    (sessionId: string) => props.api.ensureSession(sessionId),
    [props.api],
  );
  const registerEnsureCommand = useCallback(
    (sessionId: string, commandId: string) => {
      store.registerCommand(commandId, {
        surface: "session",
        control: "ensure",
        sessionId,
      });
    },
    [store],
  );
  const sessionSelection = useSessionSelection({
    sessions: state.sessions,
    commandFailures: state.commandFailures,
    selectRealtimeSession,
    ensureSession,
    registerEnsureCommand,
  });
  const detailsRequested = state.detailsSelection === null
    ? 0
    : viewportWidth < 1_024
      ? 0
      : state.preferredDetailsWidth;
  const sidebarRequested = viewportWidth < 640
    ? 0
    : viewportWidth < 1_024
      ? 56
      : state.sidebarWidth;
  const columns = computeColumns(
    viewportWidth,
    sidebarRequested,
    detailsRequested,
  );
  const onAccepted = (label: string, command: AcceptedCommand): void => {
    setFeedback(`${label} · ${command.commandId.slice(0, 8)}`);
  };
  const newSession = (): void => sessionSelection.selectSession(null);
  const startResize = (
    kind: "sidebar" | "details",
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = kind === "sidebar"
      ? columns.sidebar
      : state.preferredDetailsWidth;
    const move = (pointer: PointerEvent): void => {
      const delta = pointer.clientX - startX;
      if (kind === "sidebar") store.setSidebarWidth(startWidth + delta);
      else store.setPreferredDetailsWidth(startWidth - delta);
    };
    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("is-resizing-columns");
    };
    document.body.classList.add("is-resizing-columns");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  useEffect(() => {
    const updateViewport = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    if (feedback === null) return;
    const timer = window.setTimeout(() => setFeedback(null), 2_500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return (
    <div
      className="app-shell"
      data-details-collapsed={columns.details === 0 ? "true" : "false"}
      data-details-open={state.detailsSelection === null ? "false" : "true"}
      data-sidebar-collapsed={sidebarRequested <= 56 ? "true" : "false"}
      style={{
        gridTemplateColumns: `${columns.sidebar}px minmax(0, ${columns.center}px) ${columns.details}px`,
      }}
    >
      <AppSidebar
        collapsed={sidebarRequested <= 56}
        workspaces={workspaces}
        sessions={sessions}
        selectedSessionId={state.selectedSessionId}
        onSelectSession={sessionSelection.selectSession}
        onNewSession={newSession}
        onOpenSettings={() => store.openRuntimeDialog("general")}
        onOpenSdkConsole={() => store.openSdkConsole()}
        onToggle={() => {
          if (viewportWidth < 1_024) setProjectDrawer(true);
          else store.toggleSidebar();
        }}
        api={props.api}
        onAccepted={onAccepted}
      />
      {viewportWidth < 1_024 || sidebarRequested <= 56 ? null : (
        <div
          className="column-resizer sidebar-resizer"
          role="separator"
          aria-label="调整 Session 侧栏宽度"
          aria-orientation="vertical"
          style={{ left: columns.sidebar - 4 }}
          onPointerDown={(event) => startResize("sidebar", event)}
        />
      )}
      <main className="conversation-region" aria-label={copy.conversation.region}>
        <header className="conversation-header" data-empty={selected === undefined ? "true" : "false"}>
            <div className="mobile-nav">
              <button type="button" className="button ghost projects-trigger" onClick={() => setProjectDrawer(true)}>项目</button>
              <button type="button" className="button ghost sdk-console-trigger" aria-label="打开 SDK 控制台" onClick={() => store.openSdkConsole()}>SDK 控制台</button>
            </div>
            {selected === undefined ? null : <div className="conversation-title">
              <small>{selected.cwd}</small>
              <h1>{selected.title}</h1>
            </div>}
          </header>
        {feedback === null ? null : <output className="command-feedback" aria-live="polite">{feedback}</output>}
        <ConversationRoot
          api={props.api}
          workspaces={workspaces}
          autoResumingSessionIds={sessionSelection.autoResumingSessionIds}
          ensureFailedSessionIds={sessionSelection.ensureFailedSessionIds}
          onAccepted={onAccepted}
          realtime={props.realtime}
        />
      </main>
      {columns.details === 0 ? null : (
        <div
          className="column-resizer details-resizer"
          role="separator"
          aria-label="调整详情面板宽度"
          aria-orientation="vertical"
          style={{ right: columns.details - 4 }}
          onPointerDown={(event) => startResize("details", event)}
        />
      )}
      <DetailsPanel api={props.api} />
      <Drawer open={projectDrawer} title="项目" onClose={() => setProjectDrawer(false)}>
        <div className="project-drawer-content">
          <WorkspacePanel
            pickWorkspace={() => props.api.pickWorkspace()}
            registerWorkspace={(input) => props.api.registerWorkspace(input)}
            onAccepted={onAccepted}
          />
          <button type="button" className="sidebar-new-session" onClick={() => {
            newSession();
            setProjectDrawer(false);
          }}>{copy.session.new}</button>
          <SessionTree
            workspaces={workspaces}
            sessions={sessions}
            selectedSessionId={state.selectedSessionId}
            onSelect={(sessionId) => {
              sessionSelection.selectSession(sessionId);
              setProjectDrawer(false);
            }}
            onNewSession={() => {
              newSession();
              setProjectDrawer(false);
            }}
            api={props.api}
            onAccepted={onAccepted}
          />
        </div>
      </Drawer>
      <Drawer
        open={state.sdkConsoleOpen}
        title="SDK 控制台"
        onClose={() => store.closeSdkConsole()}
      >
        <SdkConsole />
      </Drawer>
      <RuntimeDialog
        section={state.runtimeDialogSection}
        sessionId={selected?.id ?? null}
        {...(selected === undefined || state.runtime[selected.id] === undefined
          ? {}
          : { runtime: state.runtime[selected.id] })}
        servers={selected === undefined
          ? []
          : state.mcpServerIds.flatMap((id) => {
              const server = state.mcpServers[id];
              return server?.sessionId === selected.id ? [server] : [];
            })}
        api={props.api}
        onSectionChange={(section) => store.openRuntimeDialog(section)}
        onClose={() => store.closeRuntimeDialog()}
      />
      <ErrorBanner reloadSnapshot={() => props.realtime.reloadSnapshot?.()} />
    </div>
  );
}
