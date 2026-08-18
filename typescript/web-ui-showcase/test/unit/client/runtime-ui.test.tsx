// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../src/client/features/layout/app-shell.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";

const workspaceId = "00000000-0000-4000-8000-000000000801";
const sessionId = "00000000-0000-4000-8000-000000000802";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(options: {
  modelsUnavailable?: boolean;
  modelsRecovered?: boolean;
  capabilityErrorCollisions?: boolean;
} = {}) {
  const store = new AppStore();
  const snapshot: AppSnapshot = {
    serverEpoch: "runtime-ui",
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
      title: "Runtime settings",
      cwd: "/repo",
      phase: "idle",
      awaitingUser: false,
      updatedAt: "2026-08-15T08:00:00.000Z",
    }],
    messages: {},
    queuedInputs: [],
    interactions: [],
    tasks: [],
    mcpServers: [{
      sessionId,
      name: "github",
      status: "needs-auth",
      authUrl: "https://auth.example/authorize",
    }],
    checkpointPreviews: [],
    runtime: {
      [sessionId]: {
        sessionId,
        currentModel: "balanced",
        currentPermissionMode: "acceptEdits",
        capabilities: [],
        ...(options.modelsUnavailable && !options.modelsRecovered
          ? {}
          : { models: [
              { id: "balanced", displayName: "Balanced" },
              { id: "performance", displayName: "Performance" },
            ] }),
        composerCommands: [
          { name: "model", description: "选择 Model。", argumentHint: "", execution: "model-control" },
          { name: "permissions", description: "选择 Permission Mode。", argumentHint: "", execution: "permission-control" },
          { name: "mcp", description: "管理 MCP Server。", argumentHint: "", execution: "mcp-control" },
        ],
        skills: ["review"],
        agents: [{ name: "general" }],
        plugins: [{ name: "fixture-plugin" }],
        account: { email: "developer@example.com", token: "redacted" },
        credits: { remaining: 42 },
        hooks: [],
        rawEvents: [],
        errors: options.capabilityErrorCollisions
          ? [
              {
                code: "SDK_CAPABILITY_UNAVAILABLE",
                message: "The models SDK capability could not be refreshed.",
                retryable: false,
              },
              {
                code: "SDK_CAPABILITY_UNAVAILABLE",
                message: "The MCP status SDK capability could not be refreshed.",
                retryable: false,
                details: {
                  provenance: "hook-runtime",
                  capability: "mcp",
                },
              },
            ]
          : options.modelsUnavailable || options.modelsRecovered
          ? [{
              code: "SDK_CAPABILITY_UNAVAILABLE",
              message: "The models SDK capability could not be refreshed.",
              retryable: false,
              details: {
                provenance: "runtime-refresh",
                capability: "models",
              },
            }]
          : [],
      },
    },
  };
  store.applyFrame({ kind: "snapshot", snapshot });
  store.selectSession(sessionId);
  store.applyFrame({ kind: "snapshot", snapshot });
  const accepted = async () => ({ commandId: crypto.randomUUID() });
  const api = {
    pickWorkspace: vi.fn(accepted),
    registerWorkspace: vi.fn(accepted),
    searchWorkspaceFiles: vi.fn(async () => ({ items: [], truncated: false })),
    startSession: vi.fn(async () => ({ sessionId, workspaceId })),
    ensureSession: vi.fn(accepted),
    sendMessage: vi.fn(accepted),
    cancelMessage: vi.fn(accepted),
    interruptSession: vi.fn(accepted),
    closeSession: vi.fn(accepted),
    renameSession: vi.fn(accepted),
    tagSession: vi.fn(accepted),
    forkSession: vi.fn(accepted),
    deleteSession: vi.fn(accepted),
    respondToInteraction: vi.fn(accepted),
    stopTask: vi.fn(accepted),
    backgroundTasks: vi.fn(accepted),
    previewCheckpoint: vi.fn(accepted),
    executeCheckpoint: vi.fn(accepted),
    authenticateMcp: vi.fn(accepted),
    submitMcpCallback: vi.fn(accepted),
    reconnectMcp: vi.fn(accepted),
    setModel: vi.fn(accepted),
    setPermissionMode: vi.fn(accepted),
    addDirectories: vi.fn(accepted),
    refreshRuntime: vi.fn(accepted),
    refreshContext: vi.fn(accepted),
    reloadPlugins: vi.fn(accepted),
    generateTitle: vi.fn(accepted),
    getSubagentTranscript: vi.fn(async () => ({ status: "waiting" as const })),
  };
  render(
    <StoreProvider store={store}>
      <AppShell api={api} realtime={{ selectSession: vi.fn() }} />
    </StoreProvider>,
  );
  return { api, store, snapshot };
}

describe("runtime product settings", () => {
  it("renders authoritative control state and keeps it until an async setter succeeds", async () => {
    const user = userEvent.setup();
    const { api, store } = setup();
    const modelCommandId = "00000000-0000-4000-8000-0000000008a1";
    vi.mocked(api.setModel).mockResolvedValue({ commandId: modelCommandId });

    const model = screen.getByLabelText("Model");
    const permission = screen.getByLabelText("Permission Mode");
    expect(model).toHaveValue("balanced");
    expect(permission).toHaveValue("acceptEdits");

    await user.selectOptions(model, "performance");
    expect(api.setModel).toHaveBeenCalledWith(sessionId, "performance");
    expect(model).toHaveValue("balanced");
    expect(model).toBeDisabled();
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "runtime-ui",
          sequence: 1,
          occurredAt: "2026-08-15T08:01:00.000Z",
          sessionId,
          type: "runtime.updated",
          payload: {
            sessionId,
            runtime: {
              ...store.getState().runtime[sessionId]!,
              currentModel: "performance",
            },
          },
        }],
      });
    });
    expect(model).toHaveValue("performance");
    expect(model).toBeEnabled();
    expect(model).toHaveValue("performance");
    expect(screen.queryByRole("dialog", { name: "常规设置" })).not.toBeInTheDocument();
  });

  it("shows an async Model failure beside the control and restores the prior selection", async () => {
    const user = userEvent.setup();
    const { api, store } = setup();
    const modelCommandId = "00000000-0000-4000-8000-0000000008a2";
    vi.mocked(api.setModel).mockResolvedValue({ commandId: modelCommandId });

    const model = screen.getByLabelText("Model");
    await user.selectOptions(model, "performance");
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "runtime-ui",
          sequence: 1,
          occurredAt: "2026-08-15T08:01:00.000Z",
          sessionId,
          commandId: modelCommandId,
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

    expect(screen.getByText("无法应用所选 Model。")).toBeVisible();
    expect(model).toHaveValue("balanced");
    expect(model).toBeEnabled();
    expect(model).toHaveValue("balanced");
    expect(screen.queryByRole("dialog", { name: "常规设置" })).not.toBeInTheDocument();
  });

  it("changes Model and Permission inline while keeping MCP in Settings", async () => {
    const user = userEvent.setup();
    const { api } = setup();

    const model = screen.getByLabelText("Model");
    const permission = screen.getByLabelText("Permission Mode");
    expect(
      Array.from(permission.querySelectorAll("option"), (option) => option.value),
    ).toEqual(["default", "acceptEdits", "auto"]);
    await user.selectOptions(model, "performance");
    expect(api.setModel).toHaveBeenCalledWith(sessionId, "performance");
    await user.selectOptions(permission, "auto");
    expect(api.setPermissionMode).toHaveBeenCalledWith(sessionId, "auto");
    expect(screen.queryByRole("button", { name: "MCP" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "常规设置" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    let dialog = screen.getByRole("dialog", { name: "常规设置" });
    await user.type(within(dialog).getByLabelText("附加目录"), "/shared");
    await user.click(within(dialog).getByRole("button", { name: "添加目录" }));
    expect(api.addDirectories).toHaveBeenCalledWith(sessionId, ["/shared"]);
    expect(within(dialog).getByLabelText("附加目录")).toHaveValue("");
    await user.click(within(dialog).getByRole("button", { name: "关闭 常规设置" }));

    await user.type(screen.getByLabelText("消息"), "/mcp{Enter}");
    dialog = screen.getByRole("dialog", { name: "MCP" });
    await user.click(within(dialog).getByRole("button", { name: "授权" }));
    expect(api.authenticateMcp).toHaveBeenCalledWith(sessionId, "github");
    await user.type(within(dialog).getByLabelText("OAuth callback URL"), "https://localhost/callback?code=secret");
    await user.click(within(dialog).getByRole("button", { name: "提交 callback" }));
    expect(api.submitMcpCallback).toHaveBeenCalledWith(
      sessionId,
      "github",
      "https://localhost/callback?code=secret",
    );
    await user.click(within(dialog).getByRole("button", { name: "重新连接 Session" }));
    expect(api.reconnectMcp).toHaveBeenCalledWith(sessionId, "github");
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("refreshes Account and Extensions once when opened from sidebar settings", async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await user.click(screen.getByRole("button", { name: "设置" }));
    let dialog = screen.getByRole("dialog", { name: "常规设置" });
    await user.click(within(dialog).getByRole("button", { name: "Account" }));
    dialog = screen.getByRole("dialog", { name: "Account" });
    expect(await within(dialog).findByText("developer@example.com")).toBeVisible();
    expect(within(dialog).getByText("Credits")).toBeVisible();
    expect(api.refreshRuntime).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Extensions" }));
    dialog = screen.getByRole("dialog", { name: "Extensions" });
    expect(within(dialog).getByText("review")).toBeVisible();
    expect(within(dialog).getByText("general")).toBeVisible();
    expect(within(dialog).getByText("fixture-plugin")).toBeVisible();
    expect(api.refreshRuntime).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole("button", { name: "重新加载 Plugins" }));
    expect(api.reloadPlugins).toHaveBeenCalledWith(sessionId);
  });

  it("disables only an unavailable runtime control and leaves Send usable", async () => {
    const user = userEvent.setup();
    const { api } = setup({ modelsUnavailable: true });

    const model = screen.getByLabelText("Model");
    expect(model).toBeDisabled();
    expect(model).toHaveAttribute(
      "title",
      "The models SDK capability could not be refreshed.",
    );
    expect(screen.getByLabelText("Permission Mode")).toBeEnabled();
    await user.type(screen.getByLabelText("消息"), "/model{Enter}");
    expect(
      screen.getAllByText("The models SDK capability could not be refreshed.")
        .some((element) => element.classList.contains("form-error")),
    ).toBe(true);
    expect(api.sendMessage).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("消息"));
    await user.type(screen.getByLabelText("消息"), "继续工作");
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(api.sendMessage).toHaveBeenCalledWith(sessionId, { text: "继续工作" });
  });

  it("disables Model for its current structured error even when stale models remain", () => {
    setup({ modelsRecovered: true });

    expect(screen.getByLabelText("Model")).toBeDisabled();
  });

  it("does not disable controls for same-code message collisions without exact runtime ownership", () => {
    setup({ capabilityErrorCollisions: true });

    expect(screen.getByLabelText("Model")).toBeEnabled();
    expect(screen.getByLabelText("Permission Mode")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "MCP" })).not.toBeInTheDocument();
  });
});
