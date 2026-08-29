import type { SessionRuntimeView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";

function valueText(value: unknown): string {
  if (value === null) return copy.common.unavailable;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function RecordFields(props: {
  value: Record<string, unknown> | null | undefined;
}): JSX.Element {
  if (props.value == null || Object.keys(props.value).length === 0) {
    return <p>{copy.common.unavailable}</p>;
  }
  return (
    <dl className="runtime-fields">
      {Object.entries(props.value).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{valueText(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Renders the redacted Account and Credits projections returned by the server. */
export function CreditsAccount(props: {
  account: SessionRuntimeView["account"];
  credits: SessionRuntimeView["credits"];
}): JSX.Element {
  return (
    <div className="runtime-section">
      <h3>Account</h3>
      <RecordFields value={props.account} />
      <h3>Credits</h3>
      <RecordFields value={props.credits} />
    </div>
  );
}
