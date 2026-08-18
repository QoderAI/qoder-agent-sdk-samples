// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../src/client/features/layout/app-shell.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import { copy } from "../../../src/client/i18n/zh-cn.js";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";

const workspaceId = "00000000-0000-4000-8000-000000000f01";
const sessionId = "00000000-0000-4000-8000-000000000f02";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(options: { omitVersions?: boolean } = {}) {
  const store = new AppStore();
  const snapshot: AppSnapshot = {
    serverEpoch: "sdk-console",
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
      title: "SDK diagnostics",
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
        currentModel: null,
        currentPermissionMode: "default",
        capabilities: ["runtime-diagnostic-capability"],
        context: { hiddenProductContext: true },
        hooks: [{ event: "PreToolUse", input: "[REDACTED]" }],
        rawEvents: [{ messageType: "system.init", payload: "[REDACTED]" }],
        ...(options.omitVersions === true
          ? {}
          : { versions: { sdk: "1.2.3", cli: "4.5.6" } }),
        errors: [{
          code: "SDK_RUNTIME_ERROR",
          message: "The SDK runtime reported a safe error.",
          retryable: false,
        }],
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
    authenticateMcp: vi.fn(accepted),
    submitMcpCallback: vi.fn(accepted),
    reconnectMcp: vi.fn(accepted),
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
  render(
    <StoreProvider store={store}>
      <AppShell api={api} realtime={{ selectSession: vi.fn() }} />
    </StoreProvider>,
  );
  return { api };
}

describe("SDK console", () => {
  it("keeps bounded diagnostics closed until the SDK console is opened", async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.queryByRole("dialog", { name: "SDK 控制台" })).not.toBeInTheDocument();
    expect(screen.queryByText("PreToolUse")).not.toBeInTheDocument();
    expect(screen.queryByText("system.init")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "SDK 控制台" }));

    const dialog = screen.getByRole("dialog", { name: "SDK 控制台" });
    expect(dialog).toBeVisible();
    expect(within(dialog).getByRole("heading", { name: "Hooks" })).toBeVisible();
    expect(within(dialog).getByText("PreToolUse")).toBeVisible();
    expect(within(dialog).getByText("SDK 1.2.3")).toBeVisible();
    expect(within(dialog).getByText("CLI 4.5.6")).toBeVisible();
    expect(within(dialog).getByText("The SDK runtime reported a safe error.")).toBeVisible();
    expect(within(dialog).queryByText("runtime-diagnostic-capability")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("hiddenProductContext")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("SDK Inspector")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Inspector 分区" })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Raw Events" }));
    expect(within(dialog).getByText("system.init")).toBeVisible();
    expect(within(dialog).queryByRole("heading", { name: "Hooks" })).not.toBeInTheDocument();
  });

  it("describes unreported SDK and CLI versions without implying unavailability", async () => {
    const user = userEvent.setup();
    setup({ omitVersions: true });

    await user.click(screen.getByRole("button", { name: "SDK 控制台" }));

    const dialog = screen.getByRole("dialog", { name: "SDK 控制台" });
    expect(within(dialog).getByText("SDK 版本未报告")).toBeVisible();
    expect(within(dialog).getByText("CLI 版本未报告")).toBeVisible();
    expect(within(dialog).queryByText(/不可用/u)).not.toBeInTheDocument();
  });

  it("moves MCP operations into the SDK console tab", async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await user.click(screen.getByRole("button", { name: "SDK 控制台" }));
    const dialog = screen.getByRole("dialog", { name: "SDK 控制台" });
    await user.click(within(dialog).getByRole("button", { name: "MCP" }));

    await user.click(
      await within(dialog).findByRole("button", { name: copy.runtime.authenticate }),
    );
    expect(api.authenticateMcp).toHaveBeenCalledWith(sessionId, "github");
  });

  it("refreshes Account data when the Account tab is opened", async () => {
    const user = userEvent.setup();
    const { api } = setup();

    await user.click(screen.getByRole("button", { name: "SDK 控制台" }));
    const dialog = screen.getByRole("dialog", { name: "SDK 控制台" });
    await user.click(within(dialog).getByRole("button", { name: "Account" }));

    await waitFor(() =>
      expect(api.refreshRuntime).toHaveBeenCalledWith(sessionId),
    );
  });
});
