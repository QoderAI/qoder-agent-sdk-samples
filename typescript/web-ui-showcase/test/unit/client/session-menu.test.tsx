// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  placeMenu,
  SessionMenu,
} from "../../../src/client/features/sessions/session-menu.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("flips a menu above a trigger near the viewport bottom", async () => {
  const user = userEvent.setup();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("role") === "menu") {
        return DOMRect.fromRect({ x: 0, y: 0, width: 176, height: 160 });
      }
      return DOMRect.fromRect({ x: 300, y: 740, width: 32, height: 32 });
    },
  );
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  render(<SessionMenu sessionTitle="Inspect repository" onAction={vi.fn()} />);

  await user.click(
    screen.getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    }),
  );

  const menu = screen.getByRole("menu", { name: "Inspect repository" });
  expect(menu.parentElement).toBe(document.body);
  expect(menu).toHaveStyle({ position: "fixed", top: "574px", left: "156px" });
});

it("closes on Escape, outside pointer, and scroll while returning trigger focus", async () => {
  const user = userEvent.setup();
  render(<SessionMenu sessionTitle="Inspect repository" onAction={vi.fn()} />);
  const trigger = screen.getByRole("button", {
    name: "打开 Inspect repository 的 Session 操作",
  });

  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.pointer({ target: document.body, keys: "[MouseLeft]" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  fireEvent.scroll(window);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("keeps menu actions separate from the row selection gesture", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  render(<SessionMenu sessionTitle="Inspect repository" onAction={onAction} />);

  await user.click(
    screen.getByRole("button", {
      name: "打开 Inspect repository 的 Session 操作",
    }),
  );
  await user.click(screen.getByRole("menuitem", { name: "标签" }));

  expect(onAction).toHaveBeenCalledWith("tag");
});

it("uses arrow, Home, and End keys to rove one menuitem tab stop", async () => {
  const user = userEvent.setup();
  render(<SessionMenu sessionTitle="Inspect repository" onAction={vi.fn()} />);
  const trigger = screen.getByRole("button", {
    name: "打开 Inspect repository 的 Session 操作",
  });

  await user.click(trigger);
  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1, -1]);
  expect(items[0]).toHaveFocus();

  await user.keyboard("{ArrowDown}");
  expect(items[1]).toHaveFocus();
  expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1, -1]);

  await user.keyboard("{End}");
  expect(items[3]).toHaveFocus();
  await user.keyboard("{Home}");
  expect(items[0]).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(items[3]).toHaveFocus();
});

it("returns focus to the trigger after the direct Fork action closes the menu", async () => {
  const user = userEvent.setup();
  render(<SessionMenu sessionTitle="Inspect repository" onAction={vi.fn()} />);
  const trigger = screen.getByRole("button", {
    name: "打开 Inspect repository 的 Session 操作",
  });

  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Fork" }));

  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("places menus within viewport margins", () => {
  expect(
    placeMenu(
      DOMRect.fromRect({ x: 790, y: 20, width: 20, height: 20 }),
      { width: 176, height: 160 },
      { width: 800, height: 800 },
    ),
  ).toEqual({ top: 46, left: 616 });
});
