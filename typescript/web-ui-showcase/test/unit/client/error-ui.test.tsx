// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "../../../src/client/features/errors/app-error-boundary.js";
import { ErrorBanner } from "../../../src/client/features/errors/error-banner.js";
import { CommandFailureNotice } from "../../../src/client/features/errors/command-failure-notice.js";
import { ConversationRoot } from "../../../src/client/features/conversation/conversation-root.js";
import { RuntimeDialog } from "../../../src/client/features/runtime/runtime-dialog.js";
import { AppShell } from "../../../src/client/features/layout/app-shell.js";
import { useSessionSelection } from "../../../src/client/features/sessions/use-session-selection.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import type { CommandFailureView } from "../../../src/client/store/app-state.js";
import type { SessionView } from "../../../src/shared/model.js";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";

afterEach(cleanup);

function Broken(): JSX.Element {
  throw new Error("render-secret-marker");
}

const workspaceId = "00000000-0000-4000-8000-000000000e01";
const sessionId = "00000000-0000-4000-8000-000000000e02";
const commandId = "00000000-0000-4000-8000-000000000e03";

function unavailableSnapshot(): AppSnapshot {
  return {
    serverEpoch: "error-ui",
    cursor: 0,
    workspaces: [{
      id: workspaceId,
      displayName: "sample-repo",
      path: "/repo",
      createdAt: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-15T08:00:00.000Z",
    }],
    sessions: [{
      id: sessionId,
      workspaceId,
      title: "Unavailable Session",
      cwd: "/repo",
      phase: "restorable",
      awaitingUser: false,
      failure: {
        code: "SDK_PROTOCOL_VERSION_MISMATCH",
        message: "SDK 与本地 Qoder CLI 的协议版本不兼容。",
        retryable: false,
      },
      updatedAt: "2026-08-15T08:00:00.000Z",
    }],
    messages: {},
    queuedInputs: [],
    interactions: [],
    tasks: [],
    mcpServers: [],
    checkpointPreviews: [],
    runtime: {},
  };
}

function accepted() {
  return Promise.resolve({ commandId });
}

describe("page recovery", () => {
  it("shows a safe reload action and states the Session remains live", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
    expect(screen.getByText(/Session 仍在运行/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新加载界面" })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("render-secret-marker");
  });

  it("keeps an unavailable Session failure in the selected conversation", () => {
    const store = new AppStore();
    const snapshot = unavailableSnapshot();
    store.applyFrame({ kind: "snapshot", snapshot });
    store.selectSession(sessionId);
    store.applyFrame({ kind: "snapshot", snapshot });
    const api = {
      startSession: vi.fn(async () => ({ sessionId, workspaceId })),
      sendMessage: vi.fn(accepted),
      cancelMessage: vi.fn(accepted),
      respondToInteraction: vi.fn(accepted),
      stopTask: vi.fn(accepted),
      backgroundTasks: vi.fn(accepted),
      interruptSession: vi.fn(accepted),
      refreshContext: vi.fn(accepted),
      setModel: vi.fn(accepted),
      setPermissionMode: vi.fn(accepted),
      searchWorkspaceFiles: vi.fn(async () => ({ items: [], truncated: false })),
      getSubagentTranscript: vi.fn(async () => ({ status: "waiting" as const })),
    };

    render(
      <StoreProvider store={store}>
        <ConversationRoot
          api={api}
          workspaces={snapshot.workspaces}
          autoResumingSessionIds={new Set()}
          ensureFailedSessionIds={new Set()}
          onAccepted={vi.fn()}
          realtime={{ selectSession: vi.fn() }}
        />
      </StoreProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "SDK 与本地 Qoder CLI 的协议版本不兼容。",
    );
    expect(screen.queryByRole("button", { name: /恢复 Session|关闭 Session/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toBeDisabled();
  });

  it("shows only connection ownership in the single global banner", () => {
    const store = new AppStore();
    store.applyFrame({ kind: "snapshot", snapshot: unavailableSnapshot() });
    store.applyFrame({
      kind: "events",
      events: [{
        serverEpoch: "error-ui",
        sequence: 1,
        occurredAt: "2026-08-15T08:00:01.000Z",
        commandId,
        sessionId,
        type: "command.failed",
        payload: {
          error: {
            code: "CONTROL_FAILED",
            message: "Model selection failed.",
            retryable: true,
          },
        },
      }],
    });

    render(
      <StoreProvider store={store}>
        <ErrorBanner reloadSnapshot={vi.fn()} />
      </StoreProvider>,
    );

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("实时连接会自动重试。");
    expect(screen.getByRole("alert")).not.toHaveTextContent("Model selection failed.");
    expect(screen.queryByRole("button", { name: /恢复 Session|关闭 Session/ })).not.toBeInTheDocument();
  });

  it("keeps multiple accepted runtime controls until an earlier command fails", async () => {
    const user = userEvent.setup();
    const modelCommandId = commandId;
    const permissionCommandId = "00000000-0000-4000-8000-000000000e04";
    const store = new AppStore();
    store.applyFrame({ kind: "snapshot", snapshot: unavailableSnapshot() });
    const api = {
      authenticateMcp: vi.fn(accepted),
      submitMcpCallback: vi.fn(accepted),
      reconnectMcp: vi.fn(accepted),
      setModel: vi.fn(async () => ({ commandId: modelCommandId })),
      setPermissionMode: vi.fn(async () => ({ commandId: permissionCommandId })),
      addDirectories: vi.fn(accepted),
      pickAndAddDirectory: vi.fn(accepted),
      refreshRuntime: vi.fn(accepted),
      reloadPlugins: vi.fn(accepted),
    };
    render(
      <StoreProvider store={store}>
        <RuntimeDialog
          section="general"
          sessionId={sessionId}
          runtime={{
            sessionId,
            currentModel: null,
            currentPermissionMode: "default",
            capabilities: [],
            models: [{ value: "performance", displayName: "Performance" }],
            hooks: [],
            rawEvents: [],
            errors: [],
          }}
          servers={[]}
          api={api}
          onSectionChange={vi.fn()}
          onClose={vi.fn()}
        />
      </StoreProvider>,
    );
    await user.selectOptions(screen.getByLabelText("Model"), "performance");
    await user.selectOptions(screen.getByLabelText("Permission"), "auto");
    expect(api.setModel).toHaveBeenCalledWith(sessionId, "performance");
    expect(store.getState().commandOwnerships).toHaveLength(2);

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "error-ui",
          sequence: 1,
          occurredAt: "2026-08-15T08:00:01.000Z",
          commandId: modelCommandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "MODEL_SELECTION_FAILED",
              message: "无法应用所选 Model。",
              retryable: true,
            },
          },
        }],
      });
    });

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "无法应用所选 Model。",
    );
  });

  it("keeps an immediate runtime control rejection safe and inside its dialog", async () => {
    const user = userEvent.setup();
    const store = new AppStore();
    const api = {
      authenticateMcp: vi.fn(accepted),
      submitMcpCallback: vi.fn(accepted),
      reconnectMcp: vi.fn(accepted),
      setModel: vi.fn().mockRejectedValue(new Error("credential=secret")),
      setPermissionMode: vi.fn(accepted),
      addDirectories: vi.fn(accepted),
      pickAndAddDirectory: vi.fn(accepted),
      refreshRuntime: vi.fn(accepted),
      reloadPlugins: vi.fn(accepted),
    };
    render(
      <StoreProvider store={store}>
        <RuntimeDialog
          section="general"
          sessionId={sessionId}
          runtime={{
            sessionId,
            currentModel: null,
            currentPermissionMode: "default",
            capabilities: [],
            models: [{ value: "performance", displayName: "Performance" }],
            hooks: [],
            rawEvents: [],
            errors: [],
          }}
          servers={[]}
          api={api}
          onSectionChange={vi.fn()}
          onClose={vi.fn()}
        />
      </StoreProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Model"), "performance");

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "无法提交操作，请重试。",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent("secret");
  });

  it("dismisses a protocol notice without clearing its dialog failure", async () => {
    const user = userEvent.setup();
    const store = new AppStore();
    store.applyFrame({ kind: "snapshot", snapshot: unavailableSnapshot() });
    store.registerCommand(commandId, {
      surface: "runtime",
      control: "model",
      sessionId,
    });
    store.applyFrame({
      kind: "events",
      events: [{
        serverEpoch: "error-ui",
        sequence: 1,
        occurredAt: "2026-08-15T08:00:01.000Z",
        commandId,
        sessionId,
        type: "command.failed",
        payload: {
          error: {
            code: "MODEL_SELECTION_FAILED",
            message: "无法应用所选 Model。",
            retryable: true,
          },
        },
      }],
    });
    store.setProtocolError({
      code: "PROTOCOL_ERROR",
      message: "实时事件流中断。",
      retryable: true,
    });

    render(
      <StoreProvider store={store}>
        <ErrorBanner reloadSnapshot={vi.fn()} />
        <CommandFailureNotice owner={{
          surface: "runtime",
          control: "model",
          sessionId,
        }} />
      </StoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByText("实时事件流中断。")).not.toBeInTheDocument();
    expect(screen.getByText("无法应用所选 Model。")).toBeVisible();
  });

  it("allows a later Session selection to retry a failed automatic ensure", async () => {
    const session = unavailableSnapshot().sessions[0] as SessionView;
    const ensureSession = vi
      .fn()
      .mockResolvedValueOnce({ commandId })
      .mockResolvedValueOnce({
        commandId: "00000000-0000-4000-8000-000000000e04",
      });
    const initial = {
      sessions: { [sessionId]: session },
      commandFailures: [] as CommandFailureView[],
      selectRealtimeSession: vi.fn(),
      ensureSession,
      registerEnsureCommand: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (options) => useSessionSelection(options),
      { initialProps: initial },
    );

    act(() => result.current.selectSession(sessionId));
    await waitFor(() => expect(ensureSession).toHaveBeenCalledTimes(1));
    rerender({
      ...initial,
      commandFailures: [{
        commandId,
        sessionId,
        error: {
          code: "SDK_RUNTIME_UNAVAILABLE",
          message: "SDK runtime unavailable.",
          retryable: true,
        },
      }],
    });
    await waitFor(() =>
      expect(result.current.autoResumingSessionIds.has(sessionId)).toBe(false),
    );

    act(() => result.current.selectSession(sessionId));
    await waitFor(() => expect(ensureSession).toHaveBeenCalledTimes(2));
  });

  it("owns a pre-accept ensure rejection in the selected conversation", async () => {
    const otherSessionId = "00000000-0000-4000-8000-000000000e05";
    const session = {
      ...(unavailableSnapshot().sessions[0] as SessionView),
      failure: undefined,
    };
    const ensureSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("Authorization: Bearer ensure-secret"))
      .mockResolvedValueOnce({ commandId });
    const initial = {
      sessions: {
        [sessionId]: session,
        [otherSessionId]: { ...session, id: otherSessionId, phase: "idle" as const },
      },
      commandFailures: [] as CommandFailureView[],
      selectRealtimeSession: vi.fn(),
      ensureSession,
      registerEnsureCommand: vi.fn(),
    };
    const { result } = renderHook(() => useSessionSelection(initial));

    act(() => result.current.selectSession(sessionId));
    await waitFor(() =>
      expect(result.current.ensureFailedSessionIds.has(sessionId)).toBe(true),
    );
    expect(result.current.autoResumingSessionIds.has(sessionId)).toBe(false);

    act(() => result.current.selectSession(otherSessionId));
    expect(result.current.ensureFailedSessionIds.has(sessionId)).toBe(false);

    act(() => result.current.selectSession(sessionId));
    expect(result.current.ensureFailedSessionIds.has(sessionId)).toBe(false);
    await waitFor(() => expect(ensureSession).toHaveBeenCalledTimes(2));
  });

  it("ignores an abandoned ensure rejection after an A to B to A retry", async () => {
    const otherSessionId = "00000000-0000-4000-8000-000000000e06";
    const session = {
      ...(unavailableSnapshot().sessions[0] as SessionView),
      failure: undefined,
    };
    let rejectFirst: (reason: unknown) => void = () => undefined;
    let rejectSecond: (reason: unknown) => void = () => undefined;
    const first = new Promise<{ commandId: string }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<{ commandId: string }>((_resolve, reject) => {
      rejectSecond = reject;
    });
    const ensureSession = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const options = {
      sessions: {
        [sessionId]: session,
        [otherSessionId]: { ...session, id: otherSessionId, phase: "idle" as const },
      },
      commandFailures: [] as CommandFailureView[],
      selectRealtimeSession: vi.fn(),
      ensureSession,
      registerEnsureCommand: vi.fn(),
    };
    const { result } = renderHook(() => useSessionSelection(options));

    act(() => result.current.selectSession(sessionId));
    act(() => result.current.selectSession(otherSessionId));
    act(() => result.current.selectSession(sessionId));
    expect(ensureSession).toHaveBeenCalledTimes(2);

    act(() => rejectFirst(new Error("token=stale-attempt-secret")));
    await waitFor(() =>
      expect(result.current.autoResumingSessionIds.has(sessionId)).toBe(true),
    );
    expect(result.current.ensureFailedSessionIds.has(sessionId)).toBe(false);
    expect(options.registerEnsureCommand).not.toHaveBeenCalled();

    act(() => rejectSecond(new Error("token=current-attempt-secret")));
    await waitFor(() =>
      expect(result.current.ensureFailedSessionIds.has(sessionId)).toBe(true),
    );
    expect(result.current.autoResumingSessionIds.has(sessionId)).toBe(false);
    expect(options.registerEnsureCommand).not.toHaveBeenCalled();
  });

  it("shows an ensure rejection as a safe local availability error", () => {
    const snapshot = unavailableSnapshot();
    const session = {
      ...(snapshot.sessions[0] as SessionView),
      failure: undefined,
    };
    const store = new AppStore();
    store.applyFrame({
      kind: "snapshot",
      snapshot: { ...snapshot, sessions: [session] },
    });
    store.selectSession(sessionId);
    const api = {
      startSession: vi.fn(async () => ({ sessionId, workspaceId })),
      sendMessage: vi.fn(accepted),
      cancelMessage: vi.fn(accepted),
      respondToInteraction: vi.fn(accepted),
      stopTask: vi.fn(accepted),
      backgroundTasks: vi.fn(accepted),
      interruptSession: vi.fn(accepted),
      refreshContext: vi.fn(accepted),
      setModel: vi.fn(accepted),
      setPermissionMode: vi.fn(accepted),
      searchWorkspaceFiles: vi.fn(async () => ({ items: [], truncated: false })),
      getSubagentTranscript: vi.fn(async () => ({ status: "waiting" as const })),
    };

    render(
      <StoreProvider store={store}>
        <ConversationRoot
          api={api}
          workspaces={snapshot.workspaces}
          autoResumingSessionIds={new Set()}
          ensureFailedSessionIds={new Set([sessionId])}
          onAccepted={vi.fn()}
          realtime={{ selectSession: vi.fn() }}
        />
      </StoreProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Session 暂时不可用，请重新选择后重试。",
    );
    expect(screen.getByLabelText("消息")).toBeDisabled();
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "Session 暂时不可用，请重新选择后重试。",
    );
    expect(document.body).not.toHaveTextContent("ensure-secret");
  });

  it("wires a rejected automatic ensure into the active AppShell conversation", async () => {
    const user = userEvent.setup();
    const snapshot = unavailableSnapshot();
    const session = {
      ...(snapshot.sessions[0] as SessionView),
      failure: undefined,
    };
    const store = new AppStore();
    store.applyFrame({
      kind: "snapshot",
      snapshot: { ...snapshot, sessions: [session] },
    });
    store.selectSession(sessionId);
    store.setConnectionState("connected");
    const ensureSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("token=app-shell-secret"))
      .mockResolvedValueOnce({ commandId });
    const api = {
      pickWorkspace: vi.fn(accepted),
      registerWorkspace: vi.fn(accepted),
      startSession: vi.fn(async () => ({ sessionId, workspaceId })),
      ensureSession,
      renameSession: vi.fn(accepted),
      tagSession: vi.fn(accepted),
      forkSession: vi.fn(accepted),
      deleteSession: vi.fn(accepted),
      generateTitle: vi.fn(accepted),
      sendMessage: vi.fn(accepted),
      cancelMessage: vi.fn(accepted),
      respondToInteraction: vi.fn(accepted),
      stopTask: vi.fn(accepted),
      backgroundTasks: vi.fn(accepted),
      interruptSession: vi.fn(accepted),
      refreshContext: vi.fn(accepted),
      searchWorkspaceFiles: vi.fn(async () => ({ items: [], truncated: false })),
      getSubagentTranscript: vi.fn(async () => ({ status: "waiting" as const })),
      authenticateMcp: vi.fn(accepted),
      submitMcpCallback: vi.fn(accepted),
      reconnectMcp: vi.fn(accepted),
      setModel: vi.fn(accepted),
      setPermissionMode: vi.fn(accepted),
      addDirectories: vi.fn(accepted),
      pickAndAddDirectory: vi.fn(accepted),
      refreshRuntime: vi.fn(accepted),
      reloadPlugins: vi.fn(accepted),
    };

    render(
      <StoreProvider store={store}>
        <AppShell api={api} realtime={{ selectSession: vi.fn() }} />
      </StoreProvider>,
    );

    const select = screen.getByRole("button", {
      name: /选择 Session：Unavailable Session/,
    });
    await user.click(select);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session 暂时不可用，请重新选择后重试。",
    );
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "Session 暂时不可用，请重新选择后重试。",
    );
    expect(document.body).not.toHaveTextContent("app-shell-secret");

    await user.click(select);
    expect(screen.queryByText("Session 暂时不可用，请重新选择后重试。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "正在准备 Session…",
    );
    expect(ensureSession).toHaveBeenCalledTimes(2);
  });
});
