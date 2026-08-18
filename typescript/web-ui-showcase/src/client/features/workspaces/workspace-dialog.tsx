import { useRef, useState, type FormEvent } from "react";
import { copy } from "../../i18n/zh-cn.js";
import { useModalFocus } from "../layout/modal-focus.js";

export function WorkspaceDialog(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (path: string) => Promise<void>;
}): JSX.Element | null {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useModalFocus({
    open: props.open,
    dialogRef: dialog,
    initialFocusRef: input,
    onClose: props.onClose,
  });
  if (!props.open) return null;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await props.onSubmit(path);
      setPath("");
      props.onClose();
    } catch {
      setError(copy.workspace.addFailed);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title">
        <h2 id="workspace-dialog-title">{copy.workspace.dialogTitle}</h2>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="workspace-path">{copy.workspace.absolutePath}</label>
          <input
            ref={input}
            id="workspace-path"
            value={path}
            onChange={(event) => setPath(event.currentTarget.value)}
            placeholder="/Users/me/project"
            required
          />
          {error === null ? null : <p className="form-error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="button ghost" onClick={props.onClose}>{copy.common.cancel}</button>
            <button type="submit" className="button primary">{copy.workspace.add}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
