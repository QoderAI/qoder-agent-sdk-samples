// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "../../../src/client/features/layout/drawer.js";

describe("Drawer focus lifecycle", () => {
  it("keeps the user's selected focus when an open drawer rerenders", () => {
    const { rerender } = render(
      <Drawer open title="项目" onClose={() => undefined}>
        <button type="button">保留焦点</button>
        <output>状态 1</output>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog", { name: "项目" });
    const selected = within(dialog).getByRole("button", { name: "保留焦点" });
    selected.focus();
    expect(selected).toHaveFocus();

    rerender(
      <Drawer open title="项目" onClose={() => undefined}>
        <button type="button">保留焦点</button>
        <output>状态 2</output>
      </Drawer>,
    );

    expect(screen.getByText("状态 2")).toBeVisible();
    expect(selected).toHaveFocus();
  });

  it("uses the latest close callback after an open drawer rerenders", () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const { rerender } = render(
      <Drawer open title="项目" onClose={firstClose}>
        <button type="button">保留焦点</button>
      </Drawer>,
    );

    rerender(
      <Drawer open title="项目" onClose={latestClose}>
        <button type="button">保留焦点</button>
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: "Escape" });

    expect(latestClose).toHaveBeenCalledOnce();
    expect(firstClose).not.toHaveBeenCalled();
  });
});
