// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../../../src/client/features/layout/app-shell.js";
import { MessageList } from "../../../src/client/features/conversation/message-list.js";
import { InteractionCard } from "../../../src/client/features/interactions/interaction-card.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";
import type { ConversationItem } from "../../../src/shared/model.js";
import type { AppSnapshot } from "../../../src/shared/snapshots.js";
import type { SubagentTranscriptResponse } from "../../../src/shared/subagents.js";

const sessionId = "00000000-0000-4000-8000-000000000d01";
const interactionId = "00000000-0000-4000-8000-000000000d02";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setupShell(options: {
  items?: ConversationItem[];
  interactions?: AppSnapshot["interactions"];
  tasks?: AppSnapshot["tasks"];
  checkpointPreviews?: AppSnapshot["checkpointPreviews"];
  checkpointEnabled?: boolean;
  selectedSession?: boolean;
} = {}) {
  const store = new AppStore();
  const workspaceId = "00000000-0000-4000-8000-000000000d30";
  const session: AppSnapshot["sessions"][number] = {
    id: sessionId,
    workspaceId,
    title: "Inspect repository",
    cwd: "/repo",
    phase: "idle" as const,
    awaitingUser: false,
    updatedAt: "2026-08-14T08:00:00.000Z",
    ...(options.checkpointEnabled === undefined
      ? {}
      : { checkpointEnabled: options.checkpointEnabled }),
  };
  const snapshot: AppSnapshot = {
    serverEpoch: "epoch-conversation",
    cursor: 0,
    workspaces: [{
      id: workspaceId,
      displayName: "sample-repo",
      path: "/repo",
      createdAt: "2026-08-14T08:00:00.000Z",
      updatedAt: "2026-08-14T08:00:00.000Z",
    }],
    sessions: [session],
    messages: { [sessionId]: options.items ?? [] },
    queuedInputs: [],
    interactions: options.interactions ?? [],
    tasks: options.tasks ?? [],
    mcpServers: [],
    checkpointPreviews: options.checkpointPreviews ?? [],
    runtime: {},
  };
  store.applyFrame({ kind: "snapshot", snapshot });
  if (options.selectedSession !== false) {
    store.selectSession(sessionId);
    store.applyFrame({ kind: "snapshot", snapshot });
  }
  const accepted = async () => ({ commandId: crypto.randomUUID() });
  const api = {
    pickWorkspace: vi.fn(accepted),
    startSession: vi.fn(async () => ({ sessionId, workspaceId })),
    ensureSession: vi.fn(accepted),
    renameSession: vi.fn(accepted),
    tagSession: vi.fn(accepted),
    forkSession: vi.fn(accepted),
    deleteSession: vi.fn(accepted),
    sendMessage: vi.fn(accepted),
    cancelMessage: vi.fn(accepted),
    respondToInteraction: vi.fn(accepted),
    stopTask: vi.fn(accepted),
    backgroundTasks: vi.fn(accepted),
    interruptSession: vi.fn(accepted),
    refreshContext: vi.fn(accepted),
    previewCheckpoint: vi.fn(accepted),
    executeCheckpoint: vi.fn(accepted),
    searchWorkspaceFiles: vi.fn(async () => ({ items: [], truncated: false })),
    authenticateMcp: vi.fn(accepted),
    submitMcpCallback: vi.fn(accepted),
    reconnectMcp: vi.fn(accepted),
    setModel: vi.fn(accepted),
    setPermissionMode: vi.fn(accepted),
    addDirectories: vi.fn(accepted),
    pickAndAddDirectory: vi.fn(accepted),
    refreshRuntime: vi.fn(accepted),
    reloadPlugins: vi.fn(accepted),
    generateTitle: vi.fn(accepted),
    getSubagentTranscript: vi.fn(
      async (): Promise<SubagentTranscriptResponse> => ({ status: "waiting" }),
    ),
  };
  render(
    <StoreProvider store={store}>
      <AppShell api={api} realtime={{ selectSession: vi.fn() }} />
    </StoreProvider>,
  );
  return { store, api, snapshot };
}

describe("conversation UI", () => {
  it("opens Agent execution in Details while ordinary Tools stay inline", async () => {
    const user = userEvent.setup();
    const agentTool = {
      id: "00000000-0000-4000-8000-000000000da1",
      sessionId,
      kind: "tool" as const,
      toolUseId: "agent-tool-1",
      name: "Agent",
      lifecycle: "completed" as const,
      input: { prompt: "Inspect MCP examples" },
      durationMs: 320,
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const { api } = setupShell({ items: [agentTool] });
    api.getSubagentTranscript.mockResolvedValue({
      status: "ready",
      agentId: "agent-explore",
      parentToolUseId: agentTool.toolUseId,
      items: [
        {
          id: "00000000-0000-4000-8000-000000000da2",
          sessionId,
          kind: "user",
          text: "Inspect MCP examples",
          createdAt: "2026-08-14T08:00:00.000Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000da3",
          sessionId,
          kind: "tool",
          toolUseId: "child-read",
          name: "Read",
          lifecycle: "completed",
          input: { file_path: "README.md" },
          result: { content: "MCP examples" },
          createdAt: "2026-08-14T08:00:01.000Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000da4",
          sessionId,
          kind: "assistant",
          text: "Found the examples",
          status: "complete",
          createdAt: "2026-08-14T08:00:02.000Z",
        },
      ],
    });

    const agent = screen.getByRole("button", { name: /Agent.*已完成/ });
    await user.click(agent);

    expect(agent).not.toHaveAttribute("aria-expanded", "true");
    const details = await screen.findByRole("complementary", {
      name: "Subagent 详情",
    });
    expect(api.getSubagentTranscript).toHaveBeenCalledWith(
      sessionId,
      "agent-tool-1",
      expect.anything(),
    );
    expect(within(details).getByText("任务指令")).toBeInTheDocument();
    expect(within(details).getByText("Inspect MCP examples")).toBeInTheDocument();
    expect(within(details).queryByLabelText("用户消息")).not.toBeInTheDocument();
    expect(within(details).getByText("Found the examples")).toBeInTheDocument();
    const read = within(details).getByRole("button", { name: /Read.*已完成/ });
    await user.click(read);
    expect(within(details).getByText(/README.md/)).toBeInTheDocument();
  });

  it("refreshes a running Subagent and stops polling after the Agent finishes", async () => {
    vi.useFakeTimers();
    const agentTool = {
      id: "00000000-0000-4000-8000-000000000db1",
      sessionId,
      kind: "tool" as const,
      toolUseId: "agent-tool-live",
      name: "Agent",
      lifecycle: "running" as const,
      input: { prompt: "Inspect the project" },
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const { api, store } = setupShell({ items: [agentTool] });

    fireEvent.click(screen.getByRole("button", { name: /Agent.*执行中/ }));
    await act(async () => Promise.resolve());
    expect(api.getSubagentTranscript).toHaveBeenCalledTimes(1);
    expect(screen.getByText("正在等待 Subagent 启动")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(api.getSubagentTranscript).toHaveBeenCalledTimes(2);

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 1,
          occurredAt: "2026-08-14T08:00:02.000Z",
          sessionId,
          type: "conversation.item",
          payload: {
            sessionId,
            item: { ...agentTool, lifecycle: "completed" },
          },
        }],
      });
    });
    await act(async () => Promise.resolve());
    const callsAtCompletion = api.getSubagentTranscript.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(api.getSubagentTranscript).toHaveBeenCalledTimes(callsAtCompletion);
    expect(screen.getByText("Subagent 执行记录暂不可用。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible();
  });


  it("renders one product-level assistant message and a compact tool row", async () => {
    const user = userEvent.setup();
    render(
      <MessageList
        sessionId={sessionId}
        items={[
          {
            id: "00000000-0000-4000-8000-000000000d09",
            sessionId,
            kind: "user",
            text: "请检查项目",
            createdAt: "2026-08-14T07:59:59.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000d03",
            sessionId,
            kind: "assistant",
            text: "Working on it",
            status: "streaming",
            createdAt: "2026-08-14T08:00:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000d04",
            sessionId,
            kind: "tool",
            toolUseId: "tool-1",
            name: "Bash",
            lifecycle: "completed",
            input: { command: "npm test" },
            result: { stdout: "27 tests passed" },
            startedAt: "2026-08-14T08:00:01.000Z",
            completedAt: "2026-08-14T08:00:01.120Z",
            durationMs: 120,
            createdAt: "2026-08-14T08:00:01.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByLabelText("用户消息")).toHaveTextContent("请检查项目");
    expect(screen.getByLabelText("assistant 消息")).toHaveTextContent("Working on it");
    expect(screen.getByText("Working on it")).toHaveAttribute("aria-live", "polite");
    const tool = screen.getByRole("button", { name: /Bash.*已完成/ });
    expect(tool).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/npm test/)).not.toBeInTheDocument();
    await user.click(tool);
    expect(tool).toHaveAttribute("aria-expanded", "true");
    const details = screen.getByRole("region", { name: "Bash Tool 详情" });
    expect(within(details).getByText(/npm test/)).toBeInTheDocument();
    expect(within(details).getByText(/27 tests passed/)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Tool 详情" }))
      .not.toBeInTheDocument();
  });

  it("upserts semantic transcript items inside the expanded Tool row", async () => {
    const user = userEvent.setup();
    const assistantId = "00000000-0000-4000-8000-000000000d31";
    const toolId = "00000000-0000-4000-8000-000000000d32";
    const tool = {
      id: toolId,
      sessionId,
      kind: "tool" as const,
      toolUseId: "tool-live",
      name: "Write",
      lifecycle: "requested" as const,
      input: { file_path: "notes.md", content: "draft" },
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const { store } = setupShell({
      items: [
        {
          id: assistantId,
          sessionId,
          kind: "assistant",
          text: "正在",
          status: "streaming",
          createdAt: "2026-08-14T08:00:00.000Z",
        },
        tool,
      ],
    });

    const row = screen.getByRole("button", { name: /Write.*已请求/ });
    await user.click(row);
    const details = screen.getByRole("region", { name: "Write Tool 详情" });
    expect(details).toBeVisible();
    expect(within(details).getByText("已请求")).toBeInTheDocument();

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-conversation",
            sequence: 1,
            occurredAt: "2026-08-14T08:00:00.100Z",
            sessionId,
            type: "conversation.item",
            payload: {
              sessionId,
              item: {
                ...tool,
                lifecycle: "running",
                startedAt: "2026-08-14T08:00:00.100Z",
              },
            },
          },
        ],
      });
    });

    expect(screen.getByRole("button", { name: /Write.*执行中/ })).toBe(row);
    expect(screen.getByRole("region", { name: "Write Tool 详情" })).toBe(details);
    expect(within(details).getByText("执行中")).toBeInTheDocument();

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-conversation",
            sequence: 2,
            occurredAt: "2026-08-14T08:00:00.220Z",
            sessionId,
            type: "conversation.item",
            payload: {
              sessionId,
              item: {
                ...tool,
                lifecycle: "completed",
                startedAt: "2026-08-14T08:00:00.100Z",
                completedAt: "2026-08-14T08:00:00.220Z",
                durationMs: 120,
                result: { content: "saved notes.md" },
              },
            },
          },
        ],
      });
    });

    expect(screen.getByRole("button", { name: /Write.*已完成/ })).toBe(row);
    expect(screen.getByRole("region", { name: "Write Tool 详情" })).toBe(details);
    expect(within(details).getByText("已完成")).toBeInTheDocument();
    expect(within(details).getByText(/saved notes.md/)).toBeInTheDocument();
    expect(within(details).getByText("120 ms")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Tool 详情" }))
      .not.toBeInTheDocument();
  });

  it("previews and executes a Checkpoint with modal focus preserved", async () => {
    const user = userEvent.setup();
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000d90",
      sessionId,
      kind: "user" as const,
      text: "保留这条消息",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const previewId = "00000000-0000-4000-8000-000000000d91";
    const previewCommandId = "00000000-0000-4000-8000-000000000d92";
    const executeCommandId = "00000000-0000-4000-8000-000000000d93";
    const { store, api } = setupShell({ items: [userMessage] });
    api.previewCheckpoint.mockResolvedValueOnce({ commandId: previewCommandId });
    api.executeCheckpoint.mockResolvedValueOnce({ commandId: executeCommandId });

    const trigger = screen.getByRole("button", { name: "Checkpoint" });
    await user.click(trigger);
    let dialog = screen.getByRole("dialog", { name: "回退到这条消息" });
    expect(within(dialog).getByRole("radio", { name: "仅文件" })).toHaveFocus();
    expect(within(dialog).getByRole("radio", { name: "仅对话" })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: "文件和对话" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "回退到这条消息" }))
      .not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    dialog = screen.getByRole("dialog", { name: "回退到这条消息" });
    await user.click(within(dialog).getByRole("button", { name: "预览影响" }));
    expect(api.previewCheckpoint).toHaveBeenCalledWith(sessionId, {
      userMessageId: userMessage.id,
      scope: "files",
    });
    await waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId: previewCommandId,
        owner: {
          surface: "conversation",
          control: "checkpoint-preview",
          sessionId,
        },
      }),
    );

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 1,
          occurredAt: "2026-08-14T08:00:01.000Z",
          commandId: previewCommandId,
          sessionId,
          type: "checkpoint.previewed",
          payload: {
            id: previewId,
            sessionId,
            userMessageId: userMessage.id,
            scope: "files",
            expiresAt: "2099-08-14T08:05:00.000Z",
            canRewind: true,
            status: "ready",
            filesChanged: ["src/app.ts", "src/server.ts"],
            insertions: 12,
            deletions: 3,
            failedFiles: [],
          },
        }],
      });
    });

    expect(within(dialog).getByRole("heading", { name: "预览结果" })).toBeVisible();
    expect(within(dialog).getByText("src/app.ts")).toBeVisible();
    expect(within(dialog).getByText("+12")).toBeVisible();
    const execute = within(dialog).getByRole("button", { name: "执行 Checkpoint" });
    await waitFor(() => expect(execute).toBeEnabled());
    await user.click(execute);
    expect(api.executeCheckpoint).toHaveBeenCalledWith(sessionId, {
      previewId,
      userMessageId: userMessage.id,
      scope: "files",
    });
    await waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId: executeCommandId,
        owner: {
          surface: "conversation",
          control: "checkpoint-execute",
          sessionId,
        },
      }),
    );

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-conversation",
            sequence: 2,
            occurredAt: "2026-08-14T08:00:02.000Z",
            sessionId,
            type: "checkpoint.removed",
            payload: { sessionId, previewId },
          },
          {
            serverEpoch: "epoch-conversation",
            sequence: 3,
            occurredAt: "2026-08-14T08:00:03.000Z",
            sessionId,
            type: "conversation.replaced",
            payload: { sessionId, items: [userMessage] },
          },
          {
            serverEpoch: "epoch-conversation",
            sequence: 4,
            occurredAt: "2026-08-14T08:00:04.000Z",
            commandId: executeCommandId,
            sessionId,
            type: "checkpoint.completed",
            payload: {
              sessionId,
              previewId,
              status: "success",
              failedFiles: [],
            },
          },
        ],
      });
    });

    expect(await within(dialog).findByText("Checkpoint 已完成，对话已重新加载。"))
      .toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));
    expect(trigger).toHaveFocus();
  });

  it("keeps an old Checkpoint preview non-executable while refreshing it", async () => {
    const user = userEvent.setup();
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000db0",
      sessionId,
      kind: "user" as const,
      text: "刷新 Checkpoint 预览",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const oldPreviewId = "00000000-0000-4000-8000-000000000db1";
    const { api } = setupShell({
      items: [userMessage],
      checkpointPreviews: [{
        id: oldPreviewId,
        sessionId,
        userMessageId: userMessage.id,
        scope: "files",
        expiresAt: "2099-08-14T08:05:00.000Z",
        canRewind: true,
        status: "ready",
        filesChanged: ["README.md"],
        insertions: 1,
        deletions: 0,
        failedFiles: [],
      }],
    });
    api.previewCheckpoint.mockReturnValueOnce(new Promise(() => {}));

    await user.click(screen.getByRole("button", { name: "Checkpoint" }));
    const dialog = screen.getByRole("dialog", { name: "回退到这条消息" });
    expect(within(dialog).getByRole("button", { name: "执行 Checkpoint" }))
      .toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "重新预览" }));

    expect(within(dialog).queryByRole("button", { name: "执行 Checkpoint" }))
      .not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "正在计算影响…" }))
      .toBeDisabled();
  });

  it("hides Checkpoint when the server disables the feature", () => {
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000db2",
      sessionId,
      kind: "user" as const,
      text: "关闭 Checkpoint",
      createdAt: "2026-08-14T08:00:00.000Z",
    };

    setupShell({ items: [userMessage], checkpointEnabled: false });

    expect(screen.queryByRole("button", { name: "Checkpoint" }))
      .not.toBeInTheDocument();
  });

  it("renders partial Checkpoint completion with every failed file", async () => {
    const user = userEvent.setup();
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000d94",
      sessionId,
      kind: "user" as const,
      text: "回退部分文件",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const preview = {
      id: "00000000-0000-4000-8000-000000000d95",
      sessionId,
      userMessageId: userMessage.id,
      scope: "files" as const,
      expiresAt: "2099-08-14T08:05:00.000Z",
      canRewind: true,
      status: "ready" as const,
      filesChanged: ["src/app.ts", "src/locked.ts"],
      insertions: 4,
      deletions: 2,
      failedFiles: [],
    };
    const commandId = "00000000-0000-4000-8000-000000000d96";
    const { store, api } = setupShell({
      items: [userMessage],
      checkpointPreviews: [preview],
    });
    api.executeCheckpoint.mockResolvedValueOnce({ commandId });

    await user.click(screen.getByRole("button", { name: "Checkpoint" }));
    const dialog = screen.getByRole("dialog", { name: "回退到这条消息" });
    await user.click(within(dialog).getByRole("button", {
      name: "执行 Checkpoint",
    }));
    await waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId,
        owner: {
          surface: "conversation",
          control: "checkpoint-execute",
          sessionId,
        },
      }),
    );

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-conversation",
            sequence: 1,
            occurredAt: "2026-08-14T08:00:01.000Z",
            sessionId,
            type: "checkpoint.removed",
            payload: { sessionId, previewId: preview.id },
          },
          {
            serverEpoch: "epoch-conversation",
            sequence: 2,
            occurredAt: "2026-08-14T08:00:02.000Z",
            sessionId,
            type: "conversation.replaced",
            payload: { sessionId, items: [userMessage] },
          },
          {
            serverEpoch: "epoch-conversation",
            sequence: 3,
            occurredAt: "2026-08-14T08:00:03.000Z",
            commandId,
            sessionId,
            type: "checkpoint.completed",
            payload: {
              sessionId,
              previewId: preview.id,
              status: "partial",
              failedFiles: ["src/locked.ts", "src/generated.ts"],
            },
          },
        ],
      });
    });

    expect(await within(dialog).findByText(
      "Checkpoint 已完成，但部分文件回退失败。",
    )).toBeVisible();
    expect(within(dialog).getByText("src/locked.ts")).toBeVisible();
    expect(within(dialog).getByText("src/generated.ts")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "关闭" })).toBeEnabled();
  });

  it("keeps an asynchronous Checkpoint failure inside its open dialog", async () => {
    const user = userEvent.setup();
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000d97",
      sessionId,
      kind: "user" as const,
      text: "触发回退失败",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const preview = {
      id: "00000000-0000-4000-8000-000000000d98",
      sessionId,
      userMessageId: userMessage.id,
      scope: "files" as const,
      expiresAt: "2099-08-14T08:05:00.000Z",
      canRewind: true,
      status: "ready" as const,
      filesChanged: ["src/app.ts"],
      insertions: 1,
      deletions: 1,
      failedFiles: [],
    };
    const commandId = "00000000-0000-4000-8000-000000000d99";
    const failureMessage = "Checkpoint 预览已失效，请重新预览。";
    const { store, api } = setupShell({
      items: [userMessage],
      checkpointPreviews: [preview],
    });
    api.executeCheckpoint.mockResolvedValueOnce({ commandId });

    await user.click(screen.getByRole("button", { name: "Checkpoint" }));
    const dialog = screen.getByRole("dialog", { name: "回退到这条消息" });
    await user.click(within(dialog).getByRole("button", {
      name: "执行 Checkpoint",
    }));
    await waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId,
        owner: {
          surface: "conversation",
          control: "checkpoint-execute",
          sessionId,
        },
      }),
    );

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [
          {
            serverEpoch: "epoch-conversation",
            sequence: 1,
            occurredAt: "2026-08-14T08:00:01.000Z",
            sessionId,
            type: "checkpoint.removed",
            payload: { sessionId, previewId: preview.id },
          },
          {
            serverEpoch: "epoch-conversation",
            sequence: 2,
            occurredAt: "2026-08-14T08:00:02.000Z",
            commandId,
            sessionId,
            type: "command.failed",
            payload: {
              error: {
                code: "CHECKPOINT_PREVIEW_INVALID",
                message: failureMessage,
                retryable: false,
              },
            },
          },
        ],
      });
    });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      failureMessage,
    );
    await waitFor(() => expect(store.getState().commandFailures).toEqual([]));
    expect(screen.getAllByText(failureMessage)).toHaveLength(1);
    expect(document.querySelector(".command-failure")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "预览影响" }))
      .toBeEnabled();
  });

  it("keeps one Composer DOM owner when the hero becomes an active Session", () => {
    const { store } = setupShell({ selectedSession: false });
    const composer = screen.getByLabelText("消息");
    composer.focus();

    act(() => store.selectSession(sessionId));

    expect(screen.getByLabelText("消息")).toBe(composer);
    expect(composer).toHaveFocus();
  });

  it("removes a Session draft when the Session removal event reaches ConversationRoot", async () => {
    const user = userEvent.setup();
    const { store, snapshot } = setupShell();
    await user.type(screen.getByLabelText("消息"), "删除时清理");

    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 1,
          occurredAt: "2026-08-14T08:01:00.000Z",
          sessionId,
          type: "session.removed",
          payload: { sessionId },
        }],
      });
    });
    expect(screen.getByRole("heading", { name: "Qoder" })).toBeVisible();
    expect(screen.getByLabelText("消息")).toHaveValue("");

    act(() => {
      store.selectSession(sessionId);
      store.applyFrame({ kind: "snapshot", snapshot });
    });
    expect(screen.getByLabelText("消息")).toHaveValue("");
  });

  it("keeps the resident Composer disabled while a selected Session settles", () => {
    const { store } = setupShell({ selectedSession: false });
    const composer = screen.getByLabelText("消息");

    act(() =>
      store.selectSession("00000000-0000-4000-8000-000000000d40"),
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "正在准备 Session…",
    );
    expect(screen.getByLabelText("消息")).toBe(composer);
    expect(composer).toBeDisabled();
  });

  it("keeps transcript runtime cards inside one scroll surface and Composer outside", () => {
    render(
      <div className="conversation-body">
        <MessageList
          sessionId={sessionId}
          items={[
            {
              id: "00000000-0000-4000-8000-000000000d20",
              sessionId,
              kind: "user",
              text: "检查项目",
              createdAt: "2026-08-14T08:00:00.000Z",
            },
          ]}
        >
          <div data-testid="task-card">Task card</div>
          <div data-testid="approval-card">Approval card</div>
          <div data-testid="mcp-card">MCP elicitation</div>
        </MessageList>
        <section className="composer-wrap">
          <textarea aria-label="消息" />
        </section>
      </div>,
    );

    const scroll = screen.getByTestId("conversation-scroll");
    expect(scroll).toContainElement(screen.getByLabelText("用户消息"));
    expect(scroll).toContainElement(screen.getByTestId("task-card"));
    expect(scroll).toContainElement(screen.getByTestId("approval-card"));
    expect(scroll).toContainElement(screen.getByTestId("mcp-card"));
    expect(scroll).not.toContainElement(screen.getByRole("textbox"));
  });

  it("follows new content only near the bottom and resets on Session change", () => {
    const firstItem = {
      id: "00000000-0000-4000-8000-000000000d21",
      sessionId,
      kind: "user" as const,
      text: "First",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const { rerender } = render(
      <MessageList
        sessionId={sessionId}
        items={[firstItem]}
      />,
    );
    const scroll = screen.getByTestId("conversation-scroll");
    let scrollHeight = 1_000;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, get: () => 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
      scrollTop: { configurable: true, value: 820, writable: true },
    });

    fireEvent.scroll(scroll);
    scrollHeight = 1_100;
    rerender(
      <MessageList
        sessionId={sessionId}
        items={[
          firstItem,
          {
            ...firstItem,
            id: "00000000-0000-4000-8000-000000000d22",
            text: "Second",
          },
        ]}
      />,
    );
    expect(scroll.scrollTop).toBe(1_100);

    scroll.scrollTop = 700;
    fireEvent.scroll(scroll);
    scrollHeight = 1_200;
    rerender(
      <MessageList
        sessionId={sessionId}
        items={[
          firstItem,
          {
            ...firstItem,
            id: "00000000-0000-4000-8000-000000000d22",
            text: "Second",
          },
          {
            ...firstItem,
            id: "00000000-0000-4000-8000-000000000d23",
            text: "Third",
          },
        ]}
      />,
    );
    expect(scroll.scrollTop).toBe(700);

    rerender(
      <MessageList
        sessionId="00000000-0000-4000-8000-000000000d24"
        items={[]}
      />,
    );
    expect(scroll.scrollTop).toBe(1_200);
  });

  it("keeps tool approval controls inline in the conversation", async () => {
    const user = userEvent.setup();
    const respond = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    const store = new AppStore();
    render(
      <StoreProvider store={store}>
        <InteractionCard
          interaction={{
            id: interactionId,
            sessionId,
            kind: "tool-approval",
            toolName: "Bash",
            input: { command: "pwd" },
            permissionSuggestions: [{ index: 0, label: "Remember Bash" }],
            openedAt: "2026-08-14T08:00:00.000Z",
            status: "pending",
          }}
          respond={respond}
        />
      </StoreProvider>,
    );
    await user.click(screen.getByRole("button", { name: "始终允许" }));
    expect(respond).toHaveBeenCalledWith(interactionId, {
      kind: "allow",
      suggestionIndexes: [0],
    });
  });

  it("keeps runtime Task state out of the conversation transcript", () => {
    setupShell({
      tasks: [{
        sessionId,
        taskId: "task-hidden",
        name: "Background command",
        status: "completed",
        foreground: false,
      }],
    });

    expect(screen.queryByRole("button", {
      name: "Task Background command · completed · 后台",
    })).not.toBeInTheDocument();
  });

  it("keeps Approval actions in the transcript when safe details open", async () => {
    const user = userEvent.setup();
    setupShell({
      interactions: [
        {
          id: interactionId,
          sessionId,
          kind: "tool-approval",
          toolName: "Write",
          input: { file_path: "notes.md", content: "[REDACTED]" },
          permissionSuggestions: [],
          openedAt: "2026-08-14T08:00:00.000Z",
          status: "pending",
        },
      ],
    });

    const scroll = screen.getByTestId("conversation-scroll");
    expect(within(scroll).getByLabelText("Write 等待审批")).toBeVisible();
    const allow = within(scroll).getByRole("button", { name: "允许一次" });
    expect(allow).toBeVisible();

    await user.click(within(scroll).getByRole("button", { name: "查看审批详情" }));

    const details = screen.getByRole("complementary", {
      name: "Approval 详情",
    });
    expect(within(details).getByText(/notes\.md/)).toBeInTheDocument();
    expect(within(details).getByText(/\[REDACTED\]/)).toBeInTheDocument();
    expect(within(scroll).getByRole("button", { name: "允许一次" })).toBe(allow);
  });

  it("routes Send and Stop command failures back to the Composer", async () => {
    const user = userEvent.setup();
    const sendCommandId = "00000000-0000-4000-8000-000000000d80";
    const stopCommandId = "00000000-0000-4000-8000-000000000d81";
    const { store, api } = setupShell();
    api.sendMessage.mockResolvedValueOnce({ commandId: sendCommandId });
    api.interruptSession.mockResolvedValueOnce({ commandId: stopCommandId });

    await user.type(screen.getByLabelText("消息"), "继续工作");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId: sendCommandId,
        owner: { surface: "conversation", control: "send", sessionId },
      }),
    );
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 1,
          occurredAt: "2026-08-14T08:00:01.000Z",
          commandId: sendCommandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "SEND_FAILED",
              message: "消息未能发送。",
              retryable: true,
            },
          },
        }, {
          serverEpoch: "epoch-conversation",
          sequence: 2,
          occurredAt: "2026-08-14T08:00:02.000Z",
          sessionId,
          type: "session.lifecycle",
          payload: {
            sessionId,
            lifecycle: { phase: "running", awaitingUser: false },
          },
        }],
      });
    });
    expect(screen.getByText("消息未能发送。")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "停止" }));
    await vi.waitFor(() =>
      expect(store.getState().commandOwnerships).toContainEqual({
        commandId: stopCommandId,
        owner: { surface: "conversation", control: "stop", sessionId },
      }),
    );
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 3,
          occurredAt: "2026-08-14T08:00:03.000Z",
          commandId: stopCommandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "STOP_FAILED",
              message: "当前轮次未能停止。",
              retryable: true,
            },
          },
        }],
      });
    });

    expect(screen.getByText("当前轮次未能停止。")).toBeVisible();
  });

  it("routes Interaction failures to their inline controls", async () => {
    const user = userEvent.setup();
    const interactionCommandId = "00000000-0000-4000-8000-000000000d82";
    const { store, api } = setupShell({
      interactions: [{
        id: interactionId,
        sessionId,
        kind: "tool-approval",
        toolName: "Bash",
        input: { command: "pwd" },
        permissionSuggestions: [],
        openedAt: "2026-08-14T08:00:00.000Z",
        status: "pending",
      }],
    });
    api.respondToInteraction.mockResolvedValueOnce({
      commandId: interactionCommandId,
    });

    const interaction = screen.getByLabelText("Bash 等待审批");
    await user.click(within(interaction).getByRole("button", { name: "允许一次" }));
    act(() => {
      store.applyFrame({
        kind: "events",
        events: [{
          serverEpoch: "epoch-conversation",
          sequence: 1,
          occurredAt: "2026-08-14T08:00:01.000Z",
          commandId: interactionCommandId,
          sessionId,
          type: "command.failed",
          payload: {
            error: {
              code: "INTERACTION_FAILED",
              message: "交互响应未能应用。",
              retryable: true,
            },
          },
        }],
      });
    });
    expect(within(interaction).getByRole("alert")).toHaveTextContent(
      "交互响应未能应用。",
    );
  });

});
