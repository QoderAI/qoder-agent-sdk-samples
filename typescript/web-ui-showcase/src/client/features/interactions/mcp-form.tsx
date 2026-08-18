import { useMemo, useState } from "react";
import {
  parseMcpElicitationSchema,
  validateMcpElicitationContent,
  type McpElicitationField,
  type McpElicitationScalar,
  type SupportedMcpElicitationSchema,
} from "../../../shared/mcp-elicitation-schema.js";

function formCandidate(
  fields: readonly McpElicitationField[],
  values: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const candidate = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const raw = values[field.name] ?? "";
    if (raw.length === 0) continue;
    if (field.enumValues !== undefined) {
      candidate[field.name] = field.enumValues.find(
        (option) => String(option) === raw,
      ) ?? raw;
      continue;
    }
    switch (field.type) {
      case "string":
        candidate[field.name] = raw;
        break;
      case "boolean":
        candidate[field.name] = raw === "true"
          ? true
          : raw === "false"
            ? false
            : raw;
        break;
      case "number":
      case "integer":
        candidate[field.name] = Number(raw);
        break;
    }
  }
  return candidate;
}

function SupportedForm(props: {
  parsed: SupportedMcpElicitationSchema;
  disabled: boolean;
  onAccept(content: Record<string, McpElicitationScalar>): void;
}): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({});
  const validation = validateMcpElicitationContent(
    props.parsed,
    formCandidate(props.parsed.fields, values),
  );
  return (
    <>
      {props.parsed.title === undefined
        ? null
        : <h4>{props.parsed.title}</h4>}
      {props.parsed.description === undefined
        ? null
        : <p>{props.parsed.description}</p>}
      <div className="mcp-form-fields">
        {props.parsed.fields.map((field) => {
          const value = values[field.name] ?? "";
          const update = (next: string): void =>
            setValues((current) => ({ ...current, [field.name]: next }));
          return (
            <label key={field.name}>
              <span>{field.label}{field.required ? " *" : ""}</span>
              {field.enumValues !== undefined ? (
                <select
                  aria-label={field.label}
                  value={value}
                  onChange={(event) => update(event.currentTarget.value)}
                >
                  <option value="">请选择</option>
                  {field.enumValues.map((option) => (
                    <option
                      key={`${typeof option}:${String(option)}`}
                      value={String(option)}
                    >
                      {String(option)}
                    </option>
                  ))}
                </select>
              ) : field.type === "boolean" ? (
                <select
                  aria-label={field.label}
                  value={value}
                  onChange={(event) => update(event.currentTarget.value)}
                >
                  <option value="">请选择</option>
                  <option value="true">是</option>
                  <option value="false">否</option>
                </select>
              ) : (
                <input
                  aria-label={field.label}
                  type={field.type === "string" ? "text" : "number"}
                  {...(field.type === "integer"
                    ? { step: 1 }
                    : field.type === "number"
                      ? { step: "any" }
                      : {})}
                  value={value}
                  onChange={(event) => update(event.currentTarget.value)}
                />
              )}
              {field.description === undefined
                ? null
                : <small>{field.description}</small>}
            </label>
          );
        })}
      </div>
      {validation.valid ? null : (
        <p className="form-error" role="alert">{validation.reason}</p>
      )}
      <button
        disabled={props.disabled || !validation.valid}
        className="button primary"
        type="button"
        onClick={() => {
          if (validation.valid) props.onAccept(validation.content);
        }}
      >
        接受
      </button>
    </>
  );
}

export function McpForm(props: {
  schema: unknown;
  disabled: boolean;
  onAccept(content: Record<string, McpElicitationScalar>): void;
}): JSX.Element {
  const parsed = useMemo(
    () => parseMcpElicitationSchema(props.schema),
    [props.schema],
  );
  return parsed.supported ? (
    <SupportedForm
      parsed={parsed}
      disabled={props.disabled}
      onAccept={props.onAccept}
    />
  ) : (
    <>
      <p className="form-error" role="alert">{parsed.reason}</p>
      <button className="button primary" type="button" disabled>
        接受
      </button>
    </>
  );
}
