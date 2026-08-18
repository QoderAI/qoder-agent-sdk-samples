// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../src/client/features/layout/app-shell.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";
import type {
  ComposerCommandView,
  SessionPhase,
} from "../../../src/shared/model.js";

const workspaceId = "00000000-0000-4000-8000-000000000c01";
const sessionId = "00000000-0000-4000-8000-000000000c02";
const recentWorkspaceId = "00000000-0000-4000-8000-000000000c05";
const recentSessionId = "00000000-0000-4000-8000-000000000c06";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup(options: {
  ensureSession?: () => Promise<{ commandId: string }>;
  sessionPhase?: SessionPhase;
  composerCommands?: ComposerCommandView[];
  selectedSession?: boolean;
  additionalWorkspace?: boolean;
  additionalSession?: boolean;
  forkSession?: () => Promise<{ commandId: string }>;
  deleteSession?: () => Promise<{ commandId: string }>;
} = {}) {
  const store = new AppStore();
  const snapshot: AppSnapshot = {
      serverEpoch: "epoch-ui",
      cursor: 0,
      workspaces: [
        {
          id: workspaceId,
          displayName: "sample-repo",
          path: "/repo",
          createdAt: "2026-08-14T08:00:00.000Z",
          updatedAt: "2026-08-14T08:00:00.000Z",
        },
        ...(options.additionalWorkspace
          ? [{
              id: recentWorkspaceId,
              displayName: "recent-repo",
              path: "/recent-repo",
              createdAt: "2026-08-15T08:00:00.000Z",
              updatedAt: "2026-08-15T08:00:00.000Z",
            }]
          : []),
      ],
      sessions: [
        {
          id: sessionId,
          workspaceId,
          title: "Inspect repository",
          cwd: "/repo",
          phase: options.sessionPhase ?? "restorable",
          awaitingUser: false,
          updatedAt: "2026-08-14T08:00:00.000Z",
        },
        ...(options.additionalSession
          ? [{
              id: recentSessionId,
              workspaceId,
              title: "Newest Session",
              cwd: "/repo",
              phase: "idle" as const,
              awaitingUser: false,
              updatedAt: "2026-08-15T08:00:00.000Z",
            }]
          : []),
      ],
      messages: {},
      queuedInputs: [],
      interactions: [],
      tasks: [],
      mcpServers: [],
      checkpointPreviews: [],
      runtime:
        options.composerCommands === undefined
          ? {}
          : {
              [sessionId]: {
                sessionId,
                currentModel: null,
                currentPermissionMode: "default",
                capabilities: [],
                composerCommands: options.composerCommands,
                hooks: [],
                rawEvents: [],
                errors: [],
              },
            },
  };
  store.applyFrame({ kind: "snapshot", snapshot });
  if (options.selectedSession !== false) {
    store.selectSession(sessionId);
    store.applyFrame({ kind: "snapshot", snapshot });
  }
  const accepted = async () => ({ commandId: crypto.randomUUID() });
  const api = {
    pickWorkspace: vi.fn(accepted),
    searchWorkspaceFiles: vi.fn(async () => ({
      items: [{
        path: "src/app.ts",
        mention: "src/app.ts",
        rootLabel: "sample-repo",
        source: "workspace" as const,
      }],
      truncated: false,
    })),
    createSession: vi.fn(accepted),
    startSession: vi.fn(async () => ({
      sessionId: "00000000-0000-4000-8000-000000000c04",
      workspaceId: options.additionalWorkspace ? recentWorkspaceId : workspaceId,
    })),
    ensureSession: vi.fn(options.ensureSession ?? accepted),
    closeSession: vi.fn(accepted),
    interruptSession: vi.fn(accepted),
    renameSession: vi.fn(accepted),
    tagSession: vi.fn(accepted),
    forkSession: vi.fn(options.forkSession ?? accepted),
    deleteSession: vi.fn(options.deleteSession ?? accepted),
    sendMessage: vi.fn(accepted),
    cancelMessage: vi.fn(accepted),
    respondToInteraction: vi.fn(accepted),
    stopTask: vi.fn(accepted),
    backgroundTasks: vi.fn(accepted),
    authenticateMcp: vi.fn(accepted),
    submitMcpCallback: vi.fn(accepted),
    reconnectMcp: vi.fn(accepted),
    previewCheckpoint: vi.fn(accepted),
    executeCheckpoint: vi.fn(accepted),
    setModel: vi.fn(accepted),
    setPermissionMode: vi.fn(accepted),
    addDirectories: vi.fn(accepted),
    pickAndAddDirectory: vi.fn(accepted),
    refreshRuntime: vi.fn(accepted),
    refreshContext: vi.fn(accepted),
    reloadPlugins: vi.fn(accepted),
    generateTitle: vi.fn(accepted),
    getSubagentTranscript: vi.fn(async () => ({ status: "waiting" as const })),
  };
  const realtime = { selectSession: vi.fn() };
  render(
    <StoreProvider store={store}>
      <AppShell api={api} realtime={realtime} />
    </StoreProvider>,
  );
  return { api, realtime, store };
}

describe("Workspace and Session shell", () => {
  it("shows one home Composer for the most recent Workspace and starts the first message", async () => {
    const user = userEvent.setup();
    const { api, realtime } = setup({
      selectedSession: false,
      additionalWorkspace: true,
    });

    expect(
      screen.getByRole("heading", { name: "探索未至之境" }),
    ).toBeVisible();
    expect(screen.getAllByLabelText("消息")).toHaveLength(1);
    expect(screen.getByText("Workspace：recent-repo")).toBeVisible();

    await user.type(screen.getByLabelText("消息"), "检查这个项目");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(api.startSession).toHaveBeenCalledWith({
      workspaceId: recentWorkspaceId,
      text: "检查这个项目",
    });
    expect(realtime.selectSession).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000c04",
    );
  });

  it("starts the next Session in the workspace picked from its group heading", async () => {
    const user = userEvent.setup();
    const { api } = setup({
      selectedSession: false,
      additionalWorkspace: true,
    });

    expect(screen.getByText("Workspace：recent-repo")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "在 sample-repo 新建 Session" }),
    );
    expect(screen.getByText("Workspace：sample-repo")).toBeVisible();

    await user.type(screen.getByLabelText("消息"), "检查这个项目");
    await user.click(screen.getByRole("button", { name: "发送" }));

    expect(api.startSession).toHaveBeenCalledWith({
      workspaceId,
      text: "检查这个项目",
    });
  });

  it("moves Session actions out of the conversation header", async () => {
    const user = userEvent.setup();
    setup({ sessionPhase: "idle" });

    await user.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    expect(screen.getByRole("menu", { name: "Inspect repository" })).toBeVisible();
  });

  it.each<SessionPhase>([
    "restorable",
    "idle",
    "running",
    "starting",
    "interrupting",
  ])("shows only product Session actions for a $phase Session", async (phase) => {
    const user = userEvent.setup();
    setup({ sessionPhase: phase });

    await user.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["重命名", "标签", "Fork", "删除记录"]);
  });

  it("shows Workspace and recency without lifecycle copy in Session rows", () => {
    setup({ sessionPhase: "restorable" });

    const row = screen.getByRole("button", {
      name: /^选择 Session：Inspect repository/,
    });
    expect(row).toHaveTextContent("sample-repo");
    expect(row).toHaveTextContent("8月14日");
    expect(row).not.toHaveTextContent(/可恢复|已关闭|恢复|空闲|运行中|正在启动|正在停止/);
  });

  it("sorts Sessions by descending update recency", () => {
    setup({ sessionPhase: "idle", additionalSession: true });

    expect(screen.getAllByRole("button", { name: /^选择 Session：/ }).map((row) => row.textContent)).toEqual([
      "Newest Sessionsample-repo · 8月15日",
      "Inspect repositorysample-repo · 8月14日",
    ]);
  });

  it("keeps the Session action trigger separate from Session selection", async () => {
    const user = userEvent.setup();
    const { api, realtime } = setup({ sessionPhase: "restorable" });

    await user.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    expect(realtime.selectSession).not.toHaveBeenCalled();
    expect(api.ensureSession).not.toHaveBeenCalled();
    expect(realtime.selectSession).not.toHaveBeenCalled();
  });

  it("exposes Session rows as a list without placing browser controls inside it", () => {
    setup({ sessionPhase: "idle" });

    const list = screen.getByRole("list", { name: "sample-repo 的 Sessions" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(list).queryByRole("button", { name: "新建 Session" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the resident details seat free of SDK Inspector transport UI", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1_440);
    const { store } = setup({ sessionPhase: "idle" });

    act(() => {
      store.openDetails({ kind: "task", sessionId, taskId: "task-1" });
    });

    const details = screen.getByRole("complementary", {
      name: "Task 详情",
    });
    expect(
      within(details).queryByRole("navigation", { name: "Inspector 分区" }),
    ).not.toBeInTheDocument();
  });

  it("routes controlled metadata and delete dialogs to the row Session", async () => {
    const user = userEvent.setup();
    const idle = setup({ sessionPhase: "idle" });
    const trigger = () =>
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      });

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const renameDialog = screen.getByRole("dialog", { name: "重命名 Session" });
    await user.clear(within(renameDialog).getByLabelText("Session 名称"));
    await user.type(
      within(renameDialog).getByLabelText("Session 名称"),
      "Renamed Session",
    );
    await user.click(within(renameDialog).getByRole("button", { name: "重命名" }));
    expect(idle.api.renameSession).toHaveBeenCalledWith(
      sessionId,
      "Renamed Session",
    );
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "标签" }));
    const tagDialog = screen.getByRole("dialog", { name: "设置 Session 标签" });
    await user.clear(within(tagDialog).getByLabelText("Session 标签"));
    await user.type(within(tagDialog).getByLabelText("Session 标签"), "demo");
    await user.click(within(tagDialog).getByRole("button", { name: "保存标签" }));
    expect(idle.api.tagSession).toHaveBeenCalledWith(sessionId, "demo");
    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "Fork" }));
    expect(idle.api.forkSession).toHaveBeenCalledWith(sessionId, {});

    await user.click(trigger());
    await user.click(screen.getByRole("menuitem", { name: "删除记录" }));
    const deleteDialog = screen.getByRole("dialog", { name: "删除 Session 记录" });
    expect(deleteDialog).toHaveTextContent("Inspect repository");
    expect(deleteDialog).toHaveTextContent("项目文件会保留");
    await user.click(within(deleteDialog).getByRole("button", { name: "删除记录" }));
    expect(idle.api.deleteSession).toHaveBeenCalledWith(sessionId);
  });

  it("offers SDK title generation from the controlled rename dialog", async () => {
    const user = userEvent.setup();
    const { api } = setup({ sessionPhase: "idle" });

    await user.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名 Session" });
    await user.click(
      within(dialog).getByRole("button", { name: "使用 SDK 生成标题" }),
    );

    expect(api.generateTitle).toHaveBeenCalledWith(
      sessionId,
      "Inspect repository",
    );
  });

  it("traps focus inside the rename dialog", async () => {
    const user = userEvent.setup();
    setup({ sessionPhase: "idle" });
    const trigger = screen.getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    const dialog = screen.getByRole("dialog", { name: "重命名 Session" });
    const input = within(dialog).getByLabelText("Session 名称");
    expect(input).toHaveFocus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(within(dialog).getByRole("button", { name: "重命名" })).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
  });

  it("focuses safe delete cancellation and returns focus after Escape", async () => {
    const user = userEvent.setup();
    setup({ sessionPhase: "idle" });
    const trigger = screen.getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    });

    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "删除记录" }));
    const dialog = screen.getByRole("dialog", { name: "删除 Session 记录" });
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "删除 Session 记录" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps the parent project drawer open when Escape closes a Session dialog", async () => {
    const user = userEvent.setup();
    setup({ sessionPhase: "idle" });

    await user.click(screen.getByRole("button", { name: "项目" }));
    const projectDrawer = screen.getByRole("dialog", { name: "项目" });
    const trigger = within(projectDrawer).getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "删除记录" }));

    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "删除 Session 记录" }),
    ).not.toBeInTheDocument();
    expect(projectDrawer).toBeVisible();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "项目" })).not.toBeInTheDocument();
  });

  it("keeps a pending Session delete and its parent project drawer open on Escape", async () => {
    const user = userEvent.setup();
    let resolveDelete: ((command: { commandId: string }) => void) | undefined;
    setup({
      sessionPhase: "idle",
      deleteSession: () => new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    });

    await user.click(screen.getByRole("button", { name: "项目" }));
    const projectDrawer = screen.getByRole("dialog", { name: "项目" });
    await user.click(within(projectDrawer).getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    }));
    await user.click(screen.getByRole("menuitem", { name: "删除记录" }));
    const deleteDialog = screen.getByRole("dialog", {
      name: "删除 Session 记录",
    });
    await user.click(within(deleteDialog).getByRole("button", {
      name: "删除记录",
    }));

    await user.keyboard("{Escape}");

    expect(deleteDialog).toBeVisible();
    expect(projectDrawer).toBeVisible();
    await user.tab();
    expect(deleteDialog).toContainElement(document.activeElement as HTMLElement);

    await act(async () => {
      resolveDelete?.({
        commandId: "00000000-0000-4000-8000-000000000c0a",
      });
    });
    expect(
      screen.queryByRole("dialog", { name: "删除 Session 记录" }),
    ).not.toBeInTheDocument();
  });

  it("shows a safe failure when direct Fork is rejected", async () => {
    const user = userEvent.setup();
    setup({
      sessionPhase: "idle",
      forkSession: async () => {
        throw new Error("fork-secret-marker");
      },
    });

    await user.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Fork" }));

    expect(await screen.findByText("请求未能提交，请重试。")).toBeVisible();
    expect(screen.queryByText(/fork-secret-marker/)).not.toBeInTheDocument();
  });

  it("routes an accepted Fork failure back to its Session row", async () => {
    const user = userEvent.setup();
    const forkCommandId = "00000000-0000-4000-8000-000000000c09";
    const { store } = setup({
      sessionPhase: "idle",
      forkSession: async () => ({ commandId: forkCommandId }),
    });

    await user.click(screen.getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    }));
    await user.click(screen.getByRole("menuitem", { name: "Fork" }));
    await vi.waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId: forkCommandId,
        owner: { surface: "session", control: "fork", sessionId },
      }),
    );
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-ui",
          sequence: 1,
          occurredAt: "2026-08-14T08:01:00.000Z",
          commandId: forkCommandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "SESSION_FORK_FAILED",
              message: "Session Fork 失败。",
              retryable: true,
            },
          },
        }],
      });
    });

    expect(screen.getByText("Session Fork 失败。")).toBeVisible();
  });

  it("connects Composer file discovery to the selected Session Workspace", async () => {
    const user = userEvent.setup();
    const { api } = setup({ sessionPhase: "idle" });

    await user.type(screen.getByLabelText("消息"), "@src");

    expect(api.searchWorkspaceFiles).toHaveBeenLastCalledWith(
      sessionId,
      "src",
    );
    expect(await screen.findByRole("option", { name: /src\/app.ts/ })).toBeInTheDocument();
  });

  it("targets inline Composer controls while MCP routes to the SDK console", async () => {
    const user = userEvent.setup();
    const controls: ComposerCommandView[] = [
      {
        name: "model",
        description: "选择 Model。",
        argumentHint: "",
        execution: "model-control",
      },
      {
        name: "permissions",
        description: "选择 Permission Mode。",
        argumentHint: "",
        execution: "permission-control",
      },
      {
        name: "mcp",
        description: "管理 MCP Server。",
        argumentHint: "",
        execution: "mcp-control",
      },
    ];
    const { api } = setup({
      sessionPhase: "idle",
      composerCommands: controls,
    });

    await user.type(screen.getByLabelText("消息"), "/mo{Enter}");
    expect(screen.getByLabelText("Model")).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "常规设置" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toHaveValue("");

    await user.click(screen.getByLabelText("消息"));
    await user.type(screen.getByLabelText("消息"), "/per{Enter}");
    expect(screen.getByLabelText("Permission Mode")).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "常规设置" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toHaveValue("");

    await user.click(screen.getByLabelText("消息"));
    await user.type(screen.getByLabelText("消息"), "/mc{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "SDK 控制台" });
    expect(
      within(dialog).getByRole("button", { name: "MCP" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("MCP Servers")).toBeVisible();
    expect(screen.getByLabelText("消息")).toHaveValue("");
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("selects and automatically ensures a Restorable Session", async () => {
    const user = userEvent.setup();
    const { api, realtime } = setup();

    expect(
      screen.getByRole("list", { name: "sample-repo 的 Sessions" }),
    ).toHaveTextContent("sample-repo");
    expect(
      screen.getByRole("button", { name: /^选择 Session：Inspect repository/ }),
    ).toHaveAttribute("aria-current", "page");
    await user.click(
      screen.getByRole("button", { name: /^选择 Session：Inspect repository/ }),
    );
    expect(realtime.selectSession).toHaveBeenCalledWith(sessionId);
    expect(api.ensureSession).toHaveBeenCalledWith(sessionId);
    expect(
      screen.queryByText(/Session 可用请求已接受/),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建 Session" }));
    expect(realtime.selectSession).toHaveBeenLastCalledWith(null);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("abandons an ensure attempt when New Session switches home", async () => {
    const user = userEvent.setup();
    let rejectFirst: (reason: unknown) => void = () => undefined;
    let rejectSecond: (reason: unknown) => void = () => undefined;
    const first = new Promise<{ commandId: string }>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<{ commandId: string }>((_resolve, reject) => {
      rejectSecond = reject;
    });
    let attempt = 0;
    const { api, store } = setup({
      ensureSession: () => (attempt++ === 0 ? first : second),
    });
    act(() => store.setConnectionState("connected"));
    const select = screen.getByRole("button", {
      name: /^选择 Session：Inspect repository/,
    });

    await user.click(select);
    expect(api.ensureSession).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "新建 Session" }));
    act(() => store.selectSession(null));
    expect(screen.getByRole("heading", { name: "探索未至之境" })).toBeVisible();

    await user.click(select);
    act(() => store.selectSession(sessionId));
    expect(api.ensureSession).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "正在准备 Session…",
    );

    await act(async () => rejectFirst(new Error("token=abandoned-home-secret")));
    expect(screen.queryByText("Session 暂时不可用，请重新选择后重试。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "正在准备 Session…",
    );

    await act(async () => rejectSecond(new Error("token=current-home-secret")));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Session 暂时不可用，请重新选择后重试。",
    );
    expect(document.body).not.toHaveTextContent("home-secret");
    expect(store.getState().commandOwnerships).toHaveLength(0);
  });

  it("registers only the accepted ensure result from the current selection attempt", async () => {
    const user = userEvent.setup();
    let resolveFirst: (accepted: { commandId: string }) => void = () => undefined;
    let resolveSecond: (accepted: { commandId: string }) => void = () => undefined;
    const first = new Promise<{ commandId: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<{ commandId: string }>((resolve) => {
      resolveSecond = resolve;
    });
    let attempt = 0;
    const { api, store } = setup({
      ensureSession: () => (attempt++ === 0 ? first : second),
    });
    act(() => store.setConnectionState("connected"));
    const select = screen.getByRole("button", {
      name: /^选择 Session：Inspect repository/,
    });

    await user.click(select);
    await user.click(screen.getByRole("button", { name: "新建 Session" }));
    act(() => store.selectSession(null));
    await user.click(select);
    act(() => store.selectSession(sessionId));
    expect(api.ensureSession).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst({ commandId: "abandoned-ensure-command" });
      await first;
      await Promise.resolve();
    });
    expect(store.getState().commandOwnerships).toHaveLength(0);
    expect(screen.getByLabelText("消息")).toHaveAttribute(
      "placeholder",
      "正在准备 Session…",
    );

    await act(async () => {
      resolveSecond({ commandId: "current-ensure-command" });
      await second;
      await Promise.resolve();
    });
    expect(store.getState().commandOwnerships).toEqual([
      {
        commandId: "current-ensure-command",
        owner: { surface: "session", control: "ensure", sessionId },
      },
    ]);
  });

  it("deduplicates automatic ensure and releases it after a matching failure", async () => {
    const user = userEvent.setup();
    const commandId = "00000000-0000-4000-8000-000000000c03";
    let resolveEnsure: ((accepted: { commandId: string }) => void) | undefined;
    const ensureRequest = new Promise<{ commandId: string }>((resolve) => {
      resolveEnsure = resolve;
    });
    const { api, store } = setup({
      ensureSession: () => ensureRequest,
    });
    const treeItem = screen.getByRole("button", {
      name: /^选择 Session：Inspect repository/,
    });

    await user.click(treeItem);
    await user.click(treeItem);

    expect(api.ensureSession).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("消息")).toHaveAttribute(
        "placeholder",
        "正在准备 Session…",
    );

    await act(async () => {
      resolveEnsure?.({ commandId });
      await ensureRequest;
      await Promise.resolve();
    });
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-ui",
            sequence: 1,
            occurredAt: "2026-08-14T08:01:00.000Z",
            commandId,
            sessionId,
            type: "command.failed",
            payload: {
              error: {
                code: "SESSION_ENSURE_FAILED",
                message: "Ensure failed.",
                retryable: true,
              },
            },
          },
        ],
      });
    });
    await vi.waitFor(() =>
      expect(screen.getByLabelText("消息")).toHaveAttribute(
        "placeholder",
        "Session 准备就绪后即可发送消息",
      ),
    );

    await user.click(treeItem);
    expect(api.ensureSession).toHaveBeenCalledTimes(2);
  });

  it("places ordinary accepted feedback below the header and clears it", async () => {
    vi.useFakeTimers();
    setup();

    fireEvent.click(
      screen.getByRole("button", {
        name: "打开 Inspect repository 的 Session 操作",
      }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Fork" }));
    await act(async () => Promise.resolve());
    const feedback = screen.getByRole("status");
    const header = document.querySelector(".conversation-header");

    expect(feedback).toHaveTextContent("Fork 请求已接受");
    expect(header?.nextElementSibling).toBe(feedback);

    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("replaces the manual path entry with a fresh Session action in the workspace panel", async () => {
    const user = userEvent.setup();
    const { api, realtime } = setup();

    await user.click(screen.getByRole("button", { name: "选择文件夹" }));
    expect(api.pickWorkspace).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "输入路径" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建 Session" }));
    expect(realtime.selectSession).toHaveBeenCalledWith(null);
  });
});
