import { useState } from "react";
import { copy } from "../../i18n/zh-cn.js";
import { useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";

export type AcceptedCommand = { commandId: string };

export function WorkspacePanel(props: {
  pickWorkspace: () => Promise<AcceptedCommand>;
  onNewSession: () => void;
  onAccepted: (label: string, command: AcceptedCommand) => void;
}): JSX.Element {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const store = useAppStore();
  return (
    <section className="workspace-controls" aria-label={copy.workspace.controls}>
      <button
        type="button"
        className="button primary wide"
        onClick={() => {
          setSubmitError(null);
          void props.pickWorkspace().then(
            (command) => {
              store.registerCommand(command.commandId, {
                surface: "workspace",
                control: "pick",
              });
              props.onAccepted(copy.workspace.pickerAccepted, command);
            },
            () => setSubmitError(copy.workspace.requestFailed),
          );
        }}
      >
        {copy.workspace.chooseFolder}
      </button>
      <button
        type="button"
        className="button ghost wide"
        onClick={props.onNewSession}
      >
        {copy.session.new}
      </button>
      {submitError === null ? null : (
        <p className="form-error" role="alert">{submitError}</p>
      )}
      <CommandFailureNotice owner={[{ surface: "workspace", control: "pick" }]} />
    </section>
  );
}
