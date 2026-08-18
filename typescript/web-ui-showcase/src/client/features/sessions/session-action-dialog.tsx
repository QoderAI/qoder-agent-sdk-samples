import {
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import type { SessionView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import type { AcceptedCommand } from "../workspaces/workspace-panel.js";
import type { SessionActionApi } from "./session-actions.js";
import { useModalFocus } from "../layout/modal-focus.js";

export type SessionDialogAction = "rename" | "tag" | "delete";
export type SessionAcceptedAction = SessionDialogAction | "generate-title";

export function SessionActionDialog(props: {
  action: SessionDialogAction;
  session: SessionView;
  api: SessionActionApi;
  returnFocus: HTMLElement | null;
  onAccepted: (
    label: string,
    command: AcceptedCommand,
    action: SessionAcceptedAction,
  ) => void;
  onClose: () => void;
}): JSX.Element {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(
    props.action === "tag" ? (props.session.tag ?? "") : props.session.title,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title =
    props.action === "rename"
      ? copy.session.renameDialog
      : props.action === "tag"
        ? copy.session.tagDialog
        : copy.session.deleteDialog;

  const initialFocus = props.action === "delete" ? cancel : input;
  useModalFocus({
    open: true,
    dialogRef: dialog,
    initialFocusRef: initialFocus,
    returnFocus: props.returnFocus,
    onClose: () => {
      if (!submitting) props.onClose();
    },
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const normalized = value.trim();
    if (submitting || (props.action !== "delete" && normalized.length === 0)) {
      return;
    }
    setSubmitting(true);
    setError(null);
    const request =
      props.action === "rename"
        ? props.api.renameSession(props.session.id, normalized)
        : props.action === "tag"
          ? props.api.tagSession(props.session.id, normalized)
          : props.api.deleteSession(props.session.id);
    void request.then(
      (command) => {
        props.onAccepted(
          props.action === "rename"
            ? copy.session.accepted.rename
            : props.action === "tag"
              ? copy.session.accepted.tag
              : copy.session.accepted.delete,
          command,
          props.action,
        );
        props.onClose();
      },
      () => {
        setSubmitting(false);
        setError(copy.session.actionFailed);
      },
    );
  };

  return createPortal(
    <div className="dialog-backdrop">
      <section ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        <form onSubmit={submit}>
          {props.action === "delete" ? (
            <p>{copy.session.deleteDescription(props.session.title)}</p>
          ) : (
            <label>
              <span>{props.action === "rename" ? copy.session.nameLabel : copy.session.tagLabel}</span>
              <input ref={input} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
            </label>
          )}
          {error === null ? null : <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            {props.action === "rename" ? (
              <button
                type="button"
                className="button ghost"
                disabled={submitting}
                onClick={() => {
                  const description = value.trim() || props.session.title;
                  setSubmitting(true);
                  void props.api.generateTitle(props.session.id, description).then(
                    (command) => {
                      props.onAccepted(
                        copy.session.accepted.generateTitle,
                        command,
                        "generate-title",
                      );
                      props.onClose();
                    },
                    () => {
                      setSubmitting(false);
                      setError(copy.session.actionFailed);
                    },
                  );
                }}
              >
                {copy.session.generateTitle}
              </button>
            ) : null}
            <button ref={cancel} type="button" className="button ghost" disabled={submitting} onClick={props.onClose}>{copy.common.cancel}</button>
            <button type="submit" className={props.action === "delete" ? "button danger" : "button primary"} disabled={submitting || (props.action !== "delete" && value.trim().length === 0)}>
              {props.action === "rename" ? copy.session.rename : props.action === "tag" ? copy.session.saveTag : copy.session.delete}
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
