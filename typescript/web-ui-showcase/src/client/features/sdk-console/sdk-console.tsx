import type { SessionRuntimeView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState } from "../../store/store-context.js";

function emptyRuntime(sessionId: string): SessionRuntimeView {
  return {
    sessionId,
    currentModel: null,
    currentPermissionMode: "default",
    capabilities: [],
    hooks: [],
    rawEvents: [],
    errors: [],
  };
}

/** Displays the bounded, browser-safe diagnostics projected by the server. */
export function SdkConsole(): JSX.Element {
  const state = useAppState();
  const sessionId = state.selectedSessionId;
  if (sessionId === null) {
    return <p className="sdk-console-empty">请选择一个 Session。</p>;
  }
  const runtime = state.runtime[sessionId] ?? emptyRuntime(sessionId);
  return (
    <div className="sdk-console">
      <div className="sdk-console-metadata" aria-label="Runtime 版本">
        <strong>Runtime 版本</strong>
        <span>SDK {runtime.versions?.sdk ?? copy.runtime.versionNotReported}</span>
        <span>CLI {runtime.versions?.cli ?? copy.runtime.versionNotReported}</span>
      </div>
      {runtime.errors.length === 0 ? null : (
        <div className="sdk-console-errors" aria-label="Runtime 错误">
          {runtime.errors.map((error, index) => (
            <p key={`${error.code}:${index}`}>
              <strong>{error.code}</strong> {error.message}
            </p>
          ))}
        </div>
      )}
      <section className="sdk-console-section">
        <h2>Hooks</h2>
        {runtime.hooks.length === 0 ? (
          <p>暂无 Hook 事件。</p>
        ) : runtime.hooks.map((hook, index) => (
          <article className="sdk-console-entry" key={index}>
            <strong>{typeof hook.event === "string" ? hook.event : "Hook"}</strong>
            <pre>{JSON.stringify(hook, null, 2)}</pre>
          </article>
        ))}
      </section>
      <section className="sdk-console-section">
        <h2>Raw Events</h2>
        {runtime.rawEvents.length === 0 ? (
          <p>暂无 Raw Event。</p>
        ) : runtime.rawEvents.map((event, index) => (
          <details className="sdk-console-entry" key={index}>
            <summary>
              {typeof event.messageType === "string"
                ? event.messageType
                : "unknown"}
            </summary>
            <pre>{JSON.stringify(event, null, 2)}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
