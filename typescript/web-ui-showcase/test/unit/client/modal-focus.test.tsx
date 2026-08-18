// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog, type SettingsApi } from "../../../src/client/features/runtime/settings-dialog.js";
import { Drawer } from "../../../src/client/features/layout/drawer.js";
import { AppStore } from "../../../src/client/store/app-store.js";
import { StoreProvider } from "../../../src/client/store/store-context.js";

const sessionId = "00000000-0000-4000-8000-000000000d01";
const accepted = async () => ({
  commandId: "00000000-0000-4000-8000-000000000d02",
});
const settingsApi: SettingsApi = {
  setModel: accepted,
  setPermissionMode: accepted,
  pickAndAddDirectory: accepted,
};

afterEach(cleanup);

describe("shared modal focus lifecycle", () => {
  it("traps SettingsDialog focus, uses the latest Escape callback, and restores its trigger", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const view = (onClose: () => void) => (
      <StoreProvider store={new AppStore()}>
        <SettingsDialog
          open
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
          api={settingsApi}
          onClose={onClose}
        />
      </StoreProvider>
    );
    const rendered = render(view(firstClose));
    const dialog = screen.getByRole("dialog", { name: "设置" });
    const close = within(dialog).getByRole("button", { name: "关闭 设置" });
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
        <SettingsDialog
          open={false}
          sessionId={sessionId}
          api={settingsApi}
          onClose={latestClose}
        />
      </StoreProvider>,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
