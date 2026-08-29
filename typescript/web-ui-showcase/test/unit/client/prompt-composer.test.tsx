// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerDrafts } from "../../../src/client/features/conversation/composer-drafts.js";
import {
  PromptComposer as TargetPromptComposer,
  type ComposerTarget,
} from "../../../src/client/features/conversation/prompt-composer.js";
import { PermissionPicker } from "../../../src/client/features/runtime/permission-picker.js";
import type { SendMessageInput } from "../../../src/shared/commands.js";
import type { QueuedInputView, SessionRuntimeView, SessionView } from "../../../src/shared/model.js";
import type { WorkspaceFileSearchResult } from "../../../src/shared/workspace-files.js";

const session = {
  id: "00000000-0000-4000-8000-000000000f01",
  workspaceId: "00000000-0000-4000-8000-000000000f02",
  title: "示例 Session",
  cwd: "/repo",
  phase: "idle" as const,
  awaitingUser: false,
  updatedAt: "2026-08-14T08:00:00.000Z",
};

const scrollIntoView = vi.fn();

function PromptComposer(props: {
  session: SessionView;
  autoResuming?: boolean;
  queued: QueuedInputView[];
  runtime?: SessionRuntimeView;
  send(input: SendMessageInput): Promise<{ commandId: string }>;
  cancel(uuid: string): Promise<{ commandId: string }>;
  interrupt?: () => Promise<{ commandId: string }>;
  refreshContext?: () => Promise<{ commandId: string }>;
  onAccepted?: (
    label: string,
    command: { commandId: string },
  ) => void;
  openControl?: (control: "model" | "permission" | "mcp") => void;
  setModel?: (model?: string) => Promise<{ commandId: string }>;
  setPermissionMode?: (
    mode: "default" | "acceptEdits" | "auto",
  ) => Promise<{ commandId: string }>;
  searchWorkspaceFiles?: (
    sessionId: string,
    query: string,
    signal?: AbortSignal,
  ) => Promise<WorkspaceFileSearchResult>;
}): JSX.Element {
  const [drafts] = useState(() => new ComposerDrafts());
  return (
    <TargetPromptComposer
      target={{
        kind: "session",
        session: props.session,
        ...(props.runtime === undefined
          ? {}
          : { runtime: props.runtime }),
        send: async (text) => {
          await props.send({ text });
        },
        stop: async () => {
          await props.interrupt?.();
        },
        setModel: props.setModel ??
          vi.fn(async () => ({ commandId: crypto.randomUUID() })),
        setPermissionMode: props.setPermissionMode ??
          vi.fn(async () => ({ commandId: crypto.randomUUID() })),
        openMcp: () => props.openControl?.("mcp"),
        refreshContext: async () => {
          if (props.refreshContext === undefined) {
            throw new Error("Context unavailable");
          }
          const accepted = await props.refreshContext();
          props.onAccepted?.("Context 刷新请求已接受", accepted);
        },
      }}
      drafts={drafts}
      queued={props.queued}
      cancel={props.cancel}
      {...(props.autoResuming === undefined
        ? {}
        : { autoResuming: props.autoResuming })}
      {...(props.searchWorkspaceFiles === undefined
        ? {}
        : { searchWorkspaceFiles: props.searchWorkspaceFiles })}
    />
  );
}

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return {
    promise,
    resolve: (value) => resolve?.(value),
  };
}

describe("PromptComposer", () => {
  it("purges drafts for Sessions absent from the authoritative Session set", () => {
    const drafts = new ComposerDrafts();
    drafts.write("home", "主页草稿");
    drafts.write(session.id, "保留草稿");
    drafts.write("00000000-0000-4000-8000-000000000f08", "删除草稿");

    drafts.retain(["home", session.id]);

    expect(drafts.read("home")).toBe("主页草稿");
    expect(drafts.read(session.id)).toBe("保留草稿");
    expect(drafts.read("00000000-0000-4000-8000-000000000f08")).toBe("");
  });

  it("searches the current Workspace and inserts a selected file", async () => {
    const user = userEvent.setup();
    const searchWorkspaceFiles = vi.fn(async () => ({
      items: [
        {
          path: "src/app.ts",
          mention: "src/app.ts",
          rootLabel: "sample-repo",
          source: "workspace" as const,
        },
        {
          path: "guide.md",
          mention: "/shared docs/guide.md",
          rootLabel: "shared docs",
          source: "allowed" as const,
        },
      ],
      truncated: true,
    }));
    render(
      <PromptComposer
        session={session}
        queued={[]}
        searchWorkspaceFiles={searchWorkspaceFiles}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );
    const textarea = screen.getByLabelText("消息");

    await user.type(textarea, "查看 @src");

    await vi.waitFor(() =>
      expect(searchWorkspaceFiles).toHaveBeenLastCalledWith(
        session.id,
        "src",
        expect.anything(),
      ),
    );
    const listbox = await screen.findByRole("listbox", { name: "文件建议" });
    expect(within(listbox).getByText("仅显示前 40 个结果")).toBeInTheDocument();
    await user.click(within(listbox).getByRole("option", { name: /src\/app.ts/ }));
    expect(textarea).toHaveValue("查看 @src/app.ts ");

    await user.clear(textarea);
    await user.type(textarea, "查看 @guide");
    const allowed = await screen.findByRole("option", { name: /guide\.md/ });
    expect(allowed).toHaveTextContent("shared docs");
    expect(allowed).toHaveTextContent("附加目录");
    await user.click(allowed);
    expect(textarea).toHaveValue('查看 @"/shared docs/guide.md" ');
  });

  it("debounces file discovery, aborts stale work, and closes on Session change", async () => {
    vi.useFakeTimers();
    const first = deferred<WorkspaceFileSearchResult>();
    const second = deferred<WorkspaceFileSearchResult>();
    const signals: AbortSignal[] = [];
    const searchWorkspaceFiles = vi.fn(
      (_sessionId: string, query: string, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal);
        return query === "s" ? first.promise : second.promise;
      },
    );
    const props = {
      session,
      queued: [],
      searchWorkspaceFiles,
      send: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      cancel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
    };
    const { rerender } = render(<PromptComposer {...props} />);
    const textarea = screen.getByLabelText("消息");

    fireEvent.change(textarea, {
      target: { value: "@s", selectionStart: 2 },
    });
    expect(screen.getByText("正在搜索项目文件…")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(199));
    expect(searchWorkspaceFiles).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(searchWorkspaceFiles).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    fireEvent.change(textarea, {
      target: { value: "@sr", selectionStart: 3 },
    });
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(searchWorkspaceFiles).toHaveBeenCalledTimes(2);
    await act(async () =>
      second.resolve({
        items: [{
          path: "src/right.ts",
          mention: "src/right.ts",
          rootLabel: "sample-repo",
          source: "workspace",
        }],
        truncated: false,
      }),
    );
    expect(screen.getByRole("option", { name: /src\/right.ts/ })).toBeInTheDocument();
    await act(async () =>
      first.resolve({
        items: [{
          path: "stale.ts",
          mention: "stale.ts",
          rootLabel: "sample-repo",
          source: "workspace",
        }],
        truncated: false,
      }),
    );
    expect(screen.queryByText("@stale.ts")).not.toBeInTheDocument();

    rerender(
      <PromptComposer
        {...props}
        session={{
          ...session,
          id: "00000000-0000-4000-8000-000000000f03",
          workspaceId: "00000000-0000-4000-8000-000000000f04",
        }}
      />,
    );
    expect(signals[1]?.aborted).toBe(true);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("消息")).toHaveValue("");
  });

  it("discovers SDK commands and completes the active option with Tab", async () => {
    const user = userEvent.setup();
    const textarea = render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          commands: [
            {
              name: "unsupported-dialog",
              description: "Unsupported interactive command.",
              argumentHint: "",
            },
          ],
          composerCommands: [
            {
              name: "fixture-run",
              description: "Run the fixture.",
              argumentHint: "",
              execution: "sdk-input",
            },
            {
              name: "fixture-inspect",
              description: "Inspect the fixture.",
              argumentHint: "[path]",
              execution: "sdk-input",
            },
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    ).getByLabelText("消息");

    await user.type(textarea, "/fi");

    const listbox = screen.getByRole("listbox", { name: "命令建议" });
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("/fixture-inspect");
    expect(options[0]).toHaveTextContent("[path]");
    expect(options[0]).toHaveTextContent("Inspect the fixture.");
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    scrollIntoView.mockClear();
    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    await user.keyboard("{ArrowUp}{Tab}");

    expect(textarea).toHaveValue("/fixture-inspect ");
    expect(textarea).toHaveFocus();
    expect((textarea as HTMLTextAreaElement).selectionStart).toBe(17);
    expect((textarea as HTMLTextAreaElement).selectionEnd).toBe(17);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes suggestions with Escape and completes them with a mouse", async () => {
    const user = userEvent.setup();
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          composerCommands: [
            {
              name: "fixture-inspect",
              description: "Inspect the fixture.",
              argumentHint: "[path]",
              execution: "sdk-input",
            },
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );
    const textarea = screen.getByLabelText("消息");

    await user.type(textarea, "/fi{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.type(textarea, "x{Backspace}");
    await user.click(screen.getByRole("option", { name: /fixture-inspect/ }));

    expect(textarea).toHaveValue("/fixture-inspect ");
    expect(textarea).toHaveFocus();
  });

  it("uses Enter to send, Shift+Enter for a newline, and respects IME", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          composerCommands: [
            {
              name: "fixture-inspect",
              description: "Inspect the fixture.",
              argumentHint: "[path]",
              execution: "sdk-input",
            },
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );
    const textarea = screen.getByLabelText("消息");

    await user.type(textarea, "/fi{Enter}");
    expect(send).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("/fixture-inspect ");

    await user.keyboard("{Enter}");
    expect(send).toHaveBeenLastCalledWith({ text: "/fixture-inspect" });
    expect(textarea).toHaveValue("");

    await user.type(textarea, "第一行{Shift>}{Enter}{/Shift}第二行");
    expect(textarea).toHaveValue("第一行\n第二行");
    expect(send).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows only one in-flight submission for the active target", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    const send = vi.fn(() => gate.promise);
    const drafts = new ComposerDrafts();
    render(
      <TargetPromptComposer
        target={{
          kind: "session",
          session,
          send,
          stop: vi.fn(async () => undefined),
          setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          openMcp: vi.fn(),
          refreshContext: vi.fn(async () => undefined),
        }}
        drafts={drafts}
      />,
    );
    const textarea = screen.getByLabelText("消息");
    const submit = screen.getByRole("button", { name: "发送" });
    await user.type(textarea, "只发送一次");

    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(send).toHaveBeenCalledTimes(1);
    expect(textarea).toBeDisabled();
    expect(submit).toBeDisabled();
    await act(async () => gate.resolve(undefined));
    await vi.waitFor(() => expect(textarea).toBeEnabled());
    expect(drafts.read(session.id)).toBe("");
  });

  it("does not surface a previous Session submission failure in the active Session", async () => {
    const user = userEvent.setup();
    const gate = deferred<void>();
    const drafts = new ComposerDrafts();
    const otherSession = {
      ...session,
      id: "00000000-0000-4000-8000-000000000f05",
    };
    const target = (
      selected: SessionView,
      send: Extract<ComposerTarget, { kind: "session" }>["send"],
    ): ComposerTarget => ({
      kind: "session",
      session: selected,
      send,
      stop: vi.fn(async () => undefined),
      setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      openMcp: vi.fn(),
      refreshContext: vi.fn(async () => undefined),
    });
    const failingSend = vi.fn(async () => {
      await gate.promise;
      throw new Error("Previous Session failed");
    });
    const { rerender } = render(
      <TargetPromptComposer
        target={target(session, failingSend)}
        drafts={drafts}
      />,
    );
    await user.type(screen.getByLabelText("消息"), "旧 Session 请求");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    rerender(
      <TargetPromptComposer
        target={target(otherSession, vi.fn(async () => undefined))}
        drafts={drafts}
      />,
    );
    await act(async () => gate.resolve(undefined));

    await vi.waitFor(() => expect(failingSend).toHaveBeenCalledOnce());
    expect(
      screen.queryByText("命令请求未能提交，请重试。"),
    ).not.toBeInTheDocument();
  });

  it("clears an existing Composer error when the active Session changes", async () => {
    const user = userEvent.setup();
    const drafts = new ComposerDrafts();
    const otherSession = {
      ...session,
      id: "00000000-0000-4000-8000-000000000f06",
    };
    const target = (
      selected: SessionView,
      send: Extract<ComposerTarget, { kind: "session" }>["send"],
    ): ComposerTarget => ({
      kind: "session",
      session: selected,
      send,
      stop: vi.fn(async () => undefined),
      setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      openMcp: vi.fn(),
      refreshContext: vi.fn(async () => undefined),
    });
    const { rerender } = render(
      <TargetPromptComposer
        target={target(
          session,
          vi.fn(async () => {
            throw new Error("Current Session failed");
          }),
        )}
        drafts={drafts}
      />,
    );
    await user.type(screen.getByLabelText("消息"), "失败请求");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("命令请求未能提交，请重试。");

    rerender(
      <TargetPromptComposer
        target={target(otherSession, vi.fn(async () => undefined))}
        drafts={drafts}
      />,
    );

    expect(
      screen.queryByText("命令请求未能提交，请重试。"),
    ).not.toBeInTheDocument();
  });

  it("does not carry pending runtime controls into another Session", async () => {
    const user = userEvent.setup();
    const drafts = new ComposerDrafts();
    const otherSession = {
      ...session,
      id: "00000000-0000-4000-8000-000000000f04",
    };
    const runtime = (sessionId: string): SessionRuntimeView => ({
      sessionId,
      currentModel: "balanced",
      currentPermissionMode: "default",
      capabilities: [],
      models: [
        { value: "balanced", displayName: "Balanced" },
        { value: "performance", displayName: "Performance" },
      ],
      hooks: [],
      rawEvents: [],
      errors: [],
    });
    const target = (selected: SessionView): ComposerTarget => ({
      kind: "session",
      session: selected,
      runtime: runtime(selected.id),
      send: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      openMcp: vi.fn(),
      refreshContext: vi.fn(async () => undefined),
    });
    const { rerender } = render(
      <TargetPromptComposer target={target(session)} drafts={drafts} />,
    );

    await user.selectOptions(screen.getByLabelText("Model"), "performance");
    expect(screen.getByLabelText("Model")).toBeDisabled();
    rerender(
      <TargetPromptComposer target={target(otherSession)} drafts={drafts} />,
    );

    expect(screen.getByLabelText("Model")).toBeEnabled();
    expect(screen.getByLabelText("Permission Mode")).toBeEnabled();
  });

  it("executes Model and Context commands without sending an Agent message", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    const openControl = vi.fn();
    const refreshContext = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    const onAccepted = vi.fn();
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          composerCommands: [
            {
              name: "context",
              description: "刷新 Context。",
              argumentHint: "",
              execution: "context-control",
            },
            {
              name: "model",
              description: "选择 Model。",
              argumentHint: "",
              execution: "model-control",
            },
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        openControl={openControl}
        refreshContext={refreshContext}
        onAccepted={onAccepted}
      />,
    );
    const textarea = screen.getByLabelText("消息");

    await user.type(textarea, "/mo{Enter}");
    expect(screen.getByLabelText("Model")).toHaveFocus();
    expect(openControl).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("");

    await user.type(textarea, "/co{Enter}");
    expect(textarea).toHaveValue("/context");
    expect(refreshContext).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await vi.waitFor(() => expect(refreshContext).toHaveBeenCalledOnce());
    expect(textarea).toHaveValue("");
    expect(send).not.toHaveBeenCalled();
    expect(onAccepted).toHaveBeenCalledWith(
      "Context 刷新请求已接受",
      expect.objectContaining({ commandId: expect.any(String) }),
    );
  });

  it("presents normalized Context state instead of an unavailable placeholder", () => {
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          contextStatus: "ready",
          context: {
            percentage: 0.39,
            totalTokens: 390,
            maxTokens: 1_000,
          },
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );

    expect(screen.getByText("Context 39%")).toHaveAttribute(
      "title",
      "已使用 390 / 1,000 tokens",
    );
    expect(screen.queryByText("Context 不可用")).not.toBeInTheDocument();
  });

  it("reports an empty SDK command catalog without blocking send", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    render(
      <PromptComposer
        session={session}
        queued={[]}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );

    await user.type(screen.getByLabelText("消息"), "/");
    expect(screen.getByText("当前 Session 暂无可用命令")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(send).toHaveBeenCalledWith({ text: "/" });
  });

  it("keeps PermissionMode values in the product picker", () => {
    const accepted = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    render(
      <PermissionPicker
        value="default"
        pending={false}
        setPermission={accepted}
      />,
    );

    expect(
      Array.from(
        screen
          .getByLabelText("Permission")
          .querySelectorAll<HTMLOptionElement>("option"),
        (option) => option.value,
      ),
    ).toEqual(["default", "acceptEdits", "auto"]);
  });

  it("does not expose browser scheduling controls", () => {
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    render(
      <PromptComposer
        session={session}
        queued={[]}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );

    expect(screen.queryByText("发送选项")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("发送优先级")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("运行 Agent")).not.toBeInTheDocument();
  });

  it("cancels a queued message without exposing queue priority", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    const messageUuid = "00000000-0000-4000-8000-000000000f09";
    render(
      <PromptComposer
        session={session}
        queued={[{
          sessionId: session.id,
          uuid: messageUuid,
          priority: "next",
          shouldQuery: true,
          textPreview: "排队消息",
          state: "buffered",
        }]}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={cancel}
      />,
    );

    expect(screen.getByRole("button", { name: "取消排队消息" })).toBeVisible();
    expect(screen.getByText("等待发送")).toBeVisible();
    expect(screen.queryByText("下一条")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "取消排队消息" }));
    expect(cancel).toHaveBeenCalledWith(messageUuid);
  });

  it("keeps each Session draft when the selected target changes", async () => {
    const user = userEvent.setup();
    const drafts = new ComposerDrafts();
    const otherSession = {
      ...session,
      id: "00000000-0000-4000-8000-000000000f03",
    };
    const target = (selected: typeof session): ComposerTarget => ({
      kind: "session",
      session: selected,
      send: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
      openMcp: vi.fn(),
      refreshContext: vi.fn(async () => undefined),
    });
    const { rerender } = render(
      <TargetPromptComposer target={target(session)} drafts={drafts} />,
    );

    await user.type(screen.getByLabelText("消息"), "第一个草稿");
    rerender(<TargetPromptComposer target={target(otherSession)} drafts={drafts} />);
    expect(screen.getByLabelText("消息")).toHaveValue("");
    await user.type(screen.getByLabelText("消息"), "第二个草稿");
    rerender(<TargetPromptComposer target={target(session)} drafts={drafts} />);
    expect(screen.getByLabelText("消息")).toHaveValue("第一个草稿");
  });

  it("uses one Composer for Home and Session while preserving the Home draft", async () => {
    const user = userEvent.setup();
    const drafts = new ComposerDrafts();
    const start = vi.fn(async () => undefined);
    const home = (workspaceId: string | null): ComposerTarget => ({
      kind: "home",
      workspaceId,
      start,
    });
    const { rerender, container } = render(
      <TargetPromptComposer target={home(null)} drafts={drafts} />,
    );

    expect(container.querySelector("[data-composer-variant='hero']")).not.toBeNull();
    await user.type(screen.getByLabelText("消息"), "先读懂这个项目");
    rerender(<TargetPromptComposer target={home(session.workspaceId)} drafts={drafts} />);
    expect(screen.getByLabelText("消息")).toHaveValue("先读懂这个项目");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith("先读懂这个项目"));
    expect(drafts.read("home")).toBe("");

    rerender(
      <TargetPromptComposer
        target={{
          kind: "session",
          session,
          send: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          openMcp: vi.fn(),
          refreshContext: vi.fn(async () => undefined),
        }}
        drafts={drafts}
      />,
    );
    expect(container.querySelector("[data-composer-variant='docked']")).not.toBeNull();
  });

  it("keeps the target draft when submission fails", async () => {
    const user = userEvent.setup();
    const drafts = new ComposerDrafts();
    render(
      <TargetPromptComposer
        target={{
          kind: "session",
          session,
          send: vi.fn(async () => {
            throw new Error("offline");
          }),
          stop: vi.fn(async () => undefined),
          setModel: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          setPermissionMode: vi.fn(async () => ({ commandId: crypto.randomUUID() })),
          openMcp: vi.fn(),
          refreshContext: vi.fn(async () => undefined),
        }}
        drafts={drafts}
      />,
    );

    await user.type(screen.getByLabelText("消息"), "不要丢失");
    await user.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("命令请求未能提交，请重试。")).toBeInTheDocument();
    expect(drafts.read(session.id)).toBe("不要丢失");
  });

  it("focuses inline Permission while keeping MCP in settings", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    const openControl = vi.fn();
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          composerCommands: [
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
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        openControl={openControl}
      />
    );

    await user.type(screen.getByLabelText("消息"), "/per{Enter}");
    expect(screen.getByLabelText("Permission Mode")).toHaveFocus();
    expect(openControl).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("消息"));
    await user.type(screen.getByLabelText("消息"), "/m{Enter}");
    expect(openControl).toHaveBeenCalledWith("mcp");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not render Context when maximum capacity is zero", () => {
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          contextStatus: "ready",
          context: { percentage: 0, totalTokens: 0, maxTokens: 0 },
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );

    expect(screen.queryByText("Context 0 tokens")).not.toBeInTheDocument();
  });

  it("fills an SDK prompt suggestion without sending it", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async () => ({ commandId: crypto.randomUUID() }));
    render(
      <PromptComposer
        session={session}
        queued={[]}
        runtime={{
          sessionId: session.id,
          currentModel: null,
          currentPermissionMode: "default",
          capabilities: [],
          promptSuggestions: [
            "解释这个项目\n\n查找测试失败\r\n运行测试",
            "解释这个项目",
          ],
          hooks: [],
          rawEvents: [],
          errors: [],
        }}
        send={send}
        cancel={vi.fn(async () => ({ commandId: crypto.randomUUID() }))}
      />,
    );

    expect(screen.getAllByRole("button", { name: "解释这个项目" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "查找测试失败" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "运行测试" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查找测试失败" }));
    expect(screen.getByLabelText("消息")).toHaveValue("查找测试失败");
    expect(send).not.toHaveBeenCalled();
  });
});
