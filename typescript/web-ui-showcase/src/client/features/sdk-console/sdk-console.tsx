import { useEffect, type ReactNode } from "react";
import type { McpServerView, SessionRuntimeView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import type { SdkConsoleTab } from "../../store/app-state.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import { McpPanel } from "../mcp/mcp-panel.js";
import { CreditsAccount } from "../runtime/credits-account.js";
import { useRuntimeTrack } from "../runtime/use-runtime-track.js";

type Accepted = { commandId: string };

export type SdkConsoleApi = {
  authenticateMcp(sessionId: string, name: string): Promise<Accepted>;
  submitMcpCallback(
    sessionId: string,
    name: string,
    url: string,
  ): Promise<Accepted>;
  reconnectMcp(sessionId: string, name: string): Promise<Accepted>;
  refreshRuntime(sessionId: string): Promise<Accepted>;
  reloadPlugins(sessionId: string): Promise<Accepted>;
};

const tabs: Array<{ id: SdkConsoleTab; label: string }> = [
  { id: "hooks", label: "Hooks" },
  { id: "raw-events", label: "Raw Events" },
  { id: "mcp", label: "MCP" },
  { id: "extensions", label: "Extensions" },
  { id: "account", label: "Account" },
];

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

function recordLabel(record: Record<string, unknown>): string {
  for (const key of ["displayName", "name", "id", "model"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return copy.common.unavailable;
}

function ExtensionsPanel(props: {
  runtime: SessionRuntimeView;
  reloadPlugins(): Promise<Accepted>;
}): JSX.Element {
  return (
    <div className="runtime-section">
      <h3>Skills</h3>
      <p>{props.runtime.skills?.join(", ") || copy.common.unavailable}</p>
      <h3>Agents</h3>
      <p>{props.runtime.agents?.map(recordLabel).join(", ") || copy.common.unavailable}</p>
      <h3>Plugins</h3>
      <p>{props.runtime.plugins?.map(recordLabel).join(", ") || copy.common.unavailable}</p>
      <button
        className="button ghost"
        type="button"
        onClick={() => void props.reloadPlugins().catch(() => undefined)}
      >
        {copy.runtime.reloadPlugins}
      </button>
    </div>
  );
}

/** Hosts SDK runtime observability and capability panels behind tabs. */
export function SdkConsole(props: { api: SdkConsoleApi }): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const { track, submissionError } = useRuntimeTrack();
  const sessionId = state.selectedSessionId;
  const runtime = sessionId === null ? undefined : state.runtime[sessionId];
  const tab = state.sdkConsoleTab;

  useEffect(() => {
    if (sessionId === null) return;
    if (tab !== "account" && tab !== "extensions") return;
    void track(
      props.api.refreshRuntime(sessionId),
      tab === "account" ? "refresh-account" : "refresh-extensions",
      sessionId,
    ).catch(() => undefined);
  }, [props.api, tab, sessionId, track]);

  if (sessionId === null) {
    return <p className="sdk-console-empty">请选择一个 Session。</p>;
  }
  const servers: McpServerView[] = state.mcpServerIds.flatMap((id) => {
    const server = state.mcpServers[id];
    return server?.sessionId === sessionId ? [server] : [];
  });

  let content: ReactNode;
  switch (tab) {
    case "hooks":
      content = (
        <section className="sdk-console-section">
          <h2>Hooks</h2>
          {runtime !== undefined && runtime.hooks.length > 0
            ? runtime.hooks.map((hook, index) => (
                <article className="sdk-console-entry" key={index}>
                  <strong>{typeof hook.event === "string" ? hook.event : "Hook"}</strong>
                  <pre>{JSON.stringify(hook, null, 2)}</pre>
                </article>
              ))
            : <p>暂无 Hook 事件。</p>}
        </section>
      );
      break;
    case "raw-events":
      content = (
        <section className="sdk-console-section">
          <h2>Raw Events</h2>
          {runtime !== undefined && runtime.rawEvents.length > 0
            ? runtime.rawEvents.map((event, index) => (
                <details className="sdk-console-entry" key={index}>
                  <summary>
                    {typeof event.messageType === "string" ? event.messageType : "unknown"}
                  </summary>
                  <pre>{JSON.stringify(event, null, 2)}</pre>
                </details>
              ))
            : <p>暂无 Raw Event。</p>}
        </section>
      );
      break;
    case "mcp":
      content = (
        <>
          <CommandFailureNotice owner={{ surface: "runtime", control: "mcp", sessionId }} />
          <McpPanel
            servers={servers}
            authenticate={(name) =>
              track(props.api.authenticateMcp(sessionId, name), "mcp", sessionId)
            }
            submitCallback={(name, url) =>
              track(props.api.submitMcpCallback(sessionId, name, url), "mcp", sessionId)
            }
            reconnect={(name) =>
              track(props.api.reconnectMcp(sessionId, name), "mcp", sessionId)
            }
          />
        </>
      );
      break;
    case "extensions":
      content = (
        <>
          <CommandFailureNotice owner={[
            { surface: "runtime", control: "refresh-extensions", sessionId },
            { surface: "runtime", control: "plugins", sessionId },
          ]} />
          <ExtensionsPanel
            runtime={runtime ?? emptyRuntime(sessionId)}
            reloadPlugins={() =>
              track(props.api.reloadPlugins(sessionId), "plugins", sessionId)
            }
          />
        </>
      );
      break;
    case "account":
      content = (
        <>
          <CommandFailureNotice owner={{ surface: "runtime", control: "refresh-account", sessionId }} />
          <CreditsAccount account={runtime?.account} credits={runtime?.credits} />
        </>
      );
      break;
  }

  return (
    <div className="sdk-console">
      <div className="sdk-console-metadata" aria-label="Runtime 版本">
        <strong>Runtime 版本</strong>
        <span>SDK {runtime?.versions?.sdk ?? copy.runtime.versionNotReported}</span>
        <span>CLI {runtime?.versions?.cli ?? copy.runtime.versionNotReported}</span>
      </div>
      {runtime !== undefined && runtime.errors.length > 0 ? (
        <div className="sdk-console-errors" aria-label="Runtime 错误">
          {runtime.errors.map((error, index) => (
            <p key={`${error.code}:${index}`}>
              <strong>{error.code}</strong> {error.message}
            </p>
          ))}
        </div>
      ) : null}
      <nav className="sdk-console-tabs" aria-label="SDK 控制台页签">
        {tabs.map((candidate) => (
          <button
            type="button"
            key={candidate.id}
            aria-selected={tab === candidate.id}
            onClick={() => store.setSdkConsoleTab(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div className="sdk-console-panel">
        {submissionError === null ? null : (
          <p className="form-error" role="alert">
            <strong>{copy.error.controlFailed}</strong> {submissionError}
          </p>
        )}
        {content}
      </div>
    </div>
  );
}
