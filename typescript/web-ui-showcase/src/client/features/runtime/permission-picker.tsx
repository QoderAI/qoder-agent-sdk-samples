import {
  selectablePermissionModes,
  type SelectablePermissionMode,
} from "../../../shared/commands.js";
import type { Ref } from "react";

type Accepted = { commandId: string };

/** Selects one of the three product-supported SDK Permission modes. */
export function PermissionPicker(props: {
  value: SelectablePermissionMode;
  pending: boolean;
  setPermission(mode: SelectablePermissionMode): Promise<Accepted>;
  disabledReason?: string;
  label?: string;
  selectRef?: Ref<HTMLSelectElement>;
  className?: string;
}): JSX.Element {
  const label = props.label ?? "Permission";
  return (
    <label className={props.className}>
      {label}
      <select
        ref={props.selectRef}
        aria-label={label}
        aria-describedby={props.disabledReason === undefined ? undefined : "permission-unavailable"}
        title={props.disabledReason}
        value={props.value}
        disabled={props.disabledReason !== undefined || props.pending}
        onChange={(event) =>
          void props
            .setPermission(
              event.currentTarget.value as SelectablePermissionMode,
            )
            .catch(() => undefined)
        }
      >
        {selectablePermissionModes.map((mode) => (
          <option value={mode} key={mode}>{mode}</option>
        ))}
      </select>
      {props.disabledReason === undefined ? null : (
        <small id="permission-unavailable">{props.disabledReason}</small>
      )}
    </label>
  );
}
