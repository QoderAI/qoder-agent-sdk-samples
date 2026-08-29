import {
  useRef,
  type ReactNode,
} from "react";
import { copy } from "../../i18n/zh-cn.js";
import { useModalFocus } from "./modal-focus.js";

export function Drawer(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}): JSX.Element | null {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  useModalFocus({
    open: props.open,
    dialogRef: dialog,
    initialFocusRef: closeButton,
    onClose: () => onClose.current(),
  });
  if (!props.open) return null;
  return <div className="drawer-backdrop" onMouseDown={() => onClose.current()}><section ref={dialog} role="dialog" aria-modal="true" aria-label={props.title} className="drawer" onMouseDown={(event) => event.stopPropagation()}><header><strong>{props.title}</strong><button ref={closeButton} type="button" className="icon-button" aria-label={`${copy.common.close} ${props.title}`} onClick={() => onClose.current()}>×</button></header>{props.children}</section></div>;
}
