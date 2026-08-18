import { copy } from "../../i18n/zh-cn.js";
import type { CommandOwner } from "../../store/command-ownership.js";
import { findCommandFailure } from "../../store/command-ownership.js";
import { useAppState, useAppStore } from "../../store/store-context.js";

/** Renders a command failure beside the product control that owns it. */
export function CommandFailureNotice(props: {
  owner: CommandOwner | readonly CommandOwner[];
}): JSX.Element | null {
  const state = useAppState();
  const store = useAppStore();
  const failure = findCommandFailure(state, props.owner);
  if (failure === undefined || failure.commandId === undefined) return null;
  const commandId = failure.commandId;
  return (
    <p className="form-error command-failure" role="alert">
      <span>{failure.error.message}</span>
      <button
        type="button"
        className="icon-button"
        aria-label={`${copy.error.dismiss}操作错误`}
        onClick={() => store.dismissCommandFailure(commandId)}
      >
        ×
      </button>
    </p>
  );
}
