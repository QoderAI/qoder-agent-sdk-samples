import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { copy } from "../../i18n/zh-cn.js";

export type SessionMenuAction = "rename" | "tag" | "fork" | "delete";

const menuItems: Array<{
  action: SessionMenuAction;
  label: string;
  danger?: boolean;
}> = [
  { action: "rename", label: copy.session.rename },
  { action: "tag", label: copy.session.tag },
  { action: "fork", label: copy.session.fork },
  { action: "delete", label: copy.session.delete, danger: true },
];

export function placeMenu(
  anchor: DOMRect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = anchor.bottom + 6;
  const top =
    below + menu.height <= viewport.height - 8
      ? below
      : Math.max(8, anchor.top - menu.height - 6);
  return {
    top,
    left: Math.min(
      Math.max(8, anchor.right - menu.width),
      viewport.width - menu.width - 8,
    ),
  };
}

export function SessionMenu(props: {
  sessionTitle: string;
  onAction: (action: SessionMenuAction) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  const reposition = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const menuRect = menu.current?.getBoundingClientRect();
    if (anchor === undefined || menuRect === undefined) return;
    setPosition(
      placeMenu(
        anchor,
        { width: menuRect.width, height: menuRect.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onPointerUp = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menu.current?.contains(target) &&
        !trigger.current?.contains(target)
      ) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", close, true);
    };
  }, [close, open, reposition]);

  useLayoutEffect(() => {
    if (!open) return;
    menu.current
      ?.querySelectorAll<HTMLButtonElement>("[role=menuitem]")
      [activeIndex]?.focus();
  }, [activeIndex, open]);

  const choose = (action: SessionMenuAction): void => {
    setOpen(false);
    props.onAction(action);
    if (action === "fork") trigger.current?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="session-row-action-trigger"
        aria-label={`打开 ${props.sessionTitle} 的 Session 操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          setOpen((current) => !current);
        }}
      >
        ⋯
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              className="menu-panel session-row-menu"
              role="menu"
              aria-label={props.sessionTitle}
              style={{ position: "fixed", ...position }}
              onKeyDown={(event) => {
                let next: number | undefined;
                switch (event.key) {
                  case "ArrowDown":
                    next = (activeIndex + 1) % menuItems.length;
                    break;
                  case "ArrowUp":
                    next = (activeIndex - 1 + menuItems.length) % menuItems.length;
                    break;
                  case "Home":
                    next = 0;
                    break;
                  case "End":
                    next = menuItems.length - 1;
                    break;
                }
                if (next === undefined) return;
                event.preventDefault();
                setActiveIndex(next);
              }}
            >
              {menuItems.map((item, index) => (
                <button
                  key={item.action}
                  type="button"
                  role="menuitem"
                  tabIndex={activeIndex === index ? 0 : -1}
                  className={item.danger ? "danger-text" : undefined}
                  onClick={() => choose(item.action)}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
