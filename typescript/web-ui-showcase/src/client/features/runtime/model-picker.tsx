import type { SessionRuntimeView } from "../../../shared/model.js";
import type { Ref } from "react";
import { copy } from "../../i18n/zh-cn.js";
import { readModelOptions } from "../conversation/composer-suggestions.js";

type Accepted = { commandId: string };

/** Selects the active SDK Model from the Session runtime projection. */
export function ModelPicker(props: {
  models: SessionRuntimeView["models"];
  value: string | null;
  pending: boolean;
  setModel(model?: string): Promise<Accepted>;
  disabledReason?: string;
  label?: string;
  selectRef?: Ref<HTMLSelectElement>;
  className?: string;
}): JSX.Element {
  const options = readModelOptions(props.models ?? []);
  const label = props.label ?? "Model";
  const currentMissing =
    props.value !== null && !options.some((option) => option.value === props.value);
  return (
    <label className={props.className}>
      {label}
      <select
        ref={props.selectRef}
        aria-label={label}
        aria-describedby={props.disabledReason === undefined ? undefined : "model-unavailable"}
        title={props.disabledReason}
        disabled={props.disabledReason !== undefined || props.pending}
        value={props.value ?? ""}
        onChange={(event) =>
          void props
            .setModel(event.currentTarget.value || undefined)
            .catch(() => undefined)
        }
      >
        <option value="">{copy.runtime.sdkDefault}</option>
        {currentMissing ? <option value={props.value ?? ""}>{props.value}</option> : null}
        {options.map((model) => (
          <option value={model.value} key={model.value}>{model.label}</option>
        ))}
      </select>
      {props.disabledReason === undefined ? null : (
        <small id="model-unavailable">{props.disabledReason}</small>
      )}
    </label>
  );
}
