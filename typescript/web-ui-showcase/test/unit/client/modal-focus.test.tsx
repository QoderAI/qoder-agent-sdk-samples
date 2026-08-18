// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeDialog, type RuntimeApi } from "../../../src/client/features/runtime/runtime-dialog.js";
import { WorkspaceDialog } from "../../../src/client/features/workspaces/workspace-dialog.js";
import { WorkspacePanel } from "../../../src/client/features/workspaces/workspace-panel.js";
import { Drawer } from "../../../src/client/features/layout/drawer.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";

const sessionId = "00000000-0000-4000-8000-000000000d01";
const accepted = async () => ({
  commandId: "00000000-0000-4000-8000-000000000d02",
});
const runtimeApi: RuntimeApi = {
  authenticateMcp: accepted,
  submitMcpCallback: accepted,
  reconnectMcp: accepted,
  setModel: accepted,
  setPermissionMode: accepted,
  addDirectories: accepted,
  refreshRuntime: accepted,
  reloadPlugins: accepted,
};

afterEach(cleanup);

describe("shared modal focus lifecycle", () => {
  it("traps RuntimeDialog focus, uses the latest Escape callback, and restores its trigger", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const view = (onClose: () => void) => (
      <StoreProvider store={new AppStore()}>
        <RuntimeDialog
          section="general"
          sessionId={sessionId}
          runtime={{
            sessionId,
            currentModel: "performance",
            currentPermissionMode: "default",
            capabilities: [],
            models: [{ id: "performance", displayName: "Performance" }],
            hooks: [],
            rawEvents: [],
            errors: [],
          }}
          servers={[]}
          api={runtimeApi}
          onSectionChange={() => undefined}
          onClose={onClose}
        />
      </StoreProvider>
    );
    const rendered = render(view(firstClose));
    const dialog = screen.getByRole("dialog", { name: "常规设置" });
    const close = within(dialog).getByRole("button", { name: "关闭 常规设置" });
    expect(close).toHaveFocus();

    const permission = within(dialog).getByLabelText("Permission");
    permission.focus();
    rendered.rerender(view(latestClose));
    expect(permission).toHaveFocus();

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("*")).filter(
      (element) => element.matches(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]",
      ),
    );
    focusable.at(-1)?.focus();
    await user.tab();
    expect(focusable[0]).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(latestClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();

    rendered.rerender(
      <StoreProvider store={new AppStore()}>
        <RuntimeDialog
          section={null}
          sessionId={sessionId}
          servers={[]}
          api={runtimeApi}
          onSectionChange={() => undefined}
          onClose={latestClose}
        />
      </StoreProvider>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("focuses and traps WorkspaceDialog, closes on Escape, and restores its trigger", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const close = vi.fn();
    const view = (open: boolean, onClose = close) => (
      <WorkspaceDialog open={open} onClose={onClose} onSubmit={async () => undefined} />
    );
    const rendered = render(view(true));
    const dialog = screen.getByRole("dialog", { name: "添加本地项目" });
    const path = within(dialog).getByLabelText("项目绝对路径");
    expect(path).toHaveFocus();

    const submit = within(dialog).getByRole("button", { name: "添加项目" });
    submit.focus();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(path).toHaveFocus();

    const cancel = within(dialog).getByRole("button", { name: "取消" });
    cancel.focus();
    rendered.rerender(view(true, close));
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();

    rendered.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("lets the real WorkspaceDialog close before its parent project Drawer", async () => {
    const user = userEvent.setup();
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const view = (onClose: () => void) => (
      <StoreProvider store={new AppStore()}>
        <Drawer open title="项目" onClose={onClose}>
          <WorkspacePanel
            pickWorkspace={accepted}
            registerWorkspace={accepted}
            onAccepted={() => undefined}
          />
        </Drawer>
      </StoreProvider>
    );
    const rendered = render(view(firstClose));
    const drawer = screen.getByRole("dialog", { name: "项目" });
    const trigger = within(drawer).getByRole("button", { name: "输入路径" });
    await user.click(trigger);
    const workspaceDialog = screen.getByRole("dialog", {
      name: "添加本地项目",
    });
    const path = within(workspaceDialog).getByLabelText("项目绝对路径");
    expect(path).toHaveFocus();

    rendered.rerender(view(latestClose));
    expect(path).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "添加本地项目" }),
    ).not.toBeInTheDocument();
    expect(drawer).toBeVisible();
    expect(trigger).toHaveFocus();
    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(latestClose).toHaveBeenCalledOnce();
    rendered.unmount();
  });
});
