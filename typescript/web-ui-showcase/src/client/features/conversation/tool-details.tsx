import { SafeJson } from "../../components/safe-json.js";
import type { ConversationItem } from "../../../shared/model.js";
import { copy, toolLifecycleLabel } from "../../i18n/zh-cn.js";

type ToolItem = Extract<ConversationItem, { kind: "tool" }>;

function timestamp(value: string | undefined): JSX.Element | string {
  return value === undefined ? "—" : <time dateTime={value}>{value}</time>;
}

export function ToolDetails(props: { item: ToolItem }): JSX.Element {
  const { item } = props;
  const status = toolLifecycleLabel(item.lifecycle);
  return (
    <div className="tool-details contextual-tool-details">
      <dl>
        <div><dt>{copy.tool.status}</dt><dd>{status}</dd></div>
        <div><dt>{copy.tool.startedAt}</dt><dd>{timestamp(item.startedAt)}</dd></div>
        <div><dt>{copy.tool.completedAt}</dt><dd>{timestamp(item.completedAt)}</dd></div>
        <div><dt>{copy.tool.duration}</dt><dd>{item.durationMs === undefined ? "—" : `${item.durationMs} ms`}</dd></div>
      </dl>
      <div className="tool-payloads">
        <section>
          <h4>{copy.tool.input}</h4>
          {item.input === undefined ? (
            <p>{copy.tool.waitingForData}</p>
          ) : (
            <SafeJson value={item.input} />
          )}
        </section>
        <section>
          <h4>{copy.tool.result}</h4>
          {item.result === undefined ? (
            <p>{copy.tool.waitingForData}</p>
          ) : (
            <SafeJson value={item.result} />
          )}
        </section>
      </div>
    </div>
  );
}
