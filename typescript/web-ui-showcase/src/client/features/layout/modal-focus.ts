import {
  useEffect,
  useRef,
  type RefObject,
} from "react";

const focusableSelector = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

type ModalEntry = {
  token: symbol;
  parent: ModalEntry | null;
  returnFocus: HTMLElement | null;
};

const modalStack: ModalEntry[] = [];

function removeEntry(entry: ModalEntry): boolean {
  const index = modalStack.lastIndexOf(entry);
  if (index === -1) return false;
  const wasTopmost = index === modalStack.length - 1;
  modalStack.splice(index, 1);
  return wasTopmost;
}

function restoreEntryFocus(entry: ModalEntry): void {
  let current: ModalEntry | null = entry;
  while (current !== null) {
    if (current.returnFocus?.isConnected) {
      current.returnFocus.focus();
      return;
    }
    current = current.parent;
  }
}

/** Owns one aria-modal focus lifecycle without refocusing on rerender. */
export function useModalFocus(options: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  returnFocus?: HTMLElement | null;
  onClose(): void;
}): void {
  const token = useRef(Symbol("modal"));
  const onClose = useRef(options.onClose);
  onClose.current = options.onClose;

  useEffect(() => {
    if (!options.open) return;
    const entry: ModalEntry = {
      token: token.current,
      parent: modalStack.at(-1) ?? null,
      returnFocus:
        options.returnFocus ?? (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null),
    };
    modalStack.push(entry);
    options.initialFocusRef.current?.focus();
    const keydown = (event: KeyboardEvent): void => {
      if (modalStack.at(-1)?.token !== entry.token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        options.dialogRef.current?.querySelectorAll<HTMLElement>("*") ?? [],
      ).filter((element) => element.matches(focusableSelector));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        options.dialogRef.current?.focus();
        return;
      }
      if (!options.dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      if (removeEntry(entry)) restoreEntryFocus(entry);
    };
  }, [options.open, options.initialFocusRef]);
}
