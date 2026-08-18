import { useState } from "react";
import { copy } from "../../i18n/zh-cn.js";
import { useAppStore } from "../../store/store-context.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import { WorkspaceDialog } from "./workspace-dialog.js";

export type AcceptedCommand = { commandId: string };

export function WorkspacePanel(props: {
  pickWorkspace: () => Promise<AcceptedCommand>;
  registerWorkspace: (input: { path: string }) => Promise<AcceptedCommand>;
  onAccepted: (label: string, command: AcceptedCommand) => void;
}): JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false);
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
        onClick={() => setDialogOpen(true)}
      >
        {copy.workspace.enterPath}
      </button>
      <WorkspaceDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (path) => {
          const command = await props.registerWorkspace({ path });
          store.registerCommand(command.commandId, {
            surface: "workspace",
            control: "register",
          });
          props.onAccepted(copy.workspace.accepted, command);
        }}
      />
      {submitError === null ? null : (
        <p className="form-error" role="alert">{submitError}</p>
      )}
      <CommandFailureNotice owner={[
        { surface: "workspace", control: "pick" },
        { surface: "workspace", control: "register" },
      ]} />
    </section>
  );
}
