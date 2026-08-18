import { useState } from "react";
import type { McpServerView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";

type Accepted = { commandId: string };
export function McpPanel(props: {
  servers: McpServerView[];
  authenticate: (name: string) => Promise<Accepted>;
  submitCallback: (name: string, url: string) => Promise<Accepted>;
  reconnect: (name: string) => Promise<Accepted>;
}): JSX.Element {
  const [callbacks, setCallbacks] = useState<Record<string, string>>({});
  return <div className="runtime-section"><h3>{copy.runtime.mcpServers}</h3>{props.servers.length === 0 ? <p>{copy.runtime.noMcpStatus}</p> : props.servers.map((server) => <article className="runtime-card" key={server.name}><header><strong>{server.name}</strong><span>{server.status}</span></header>{server.authUrl === undefined ? null : <a href={server.authUrl} target="_blank" rel="noreferrer">{copy.runtime.openAuthorization}</a>}<div className="stack-actions">{server.status === "needs-auth" ? <button className="button primary" type="button" onClick={() => void props.authenticate(server.name).catch(() => undefined)}>{copy.runtime.authenticate}</button> : null}<button className="button ghost" type="button" onClick={() => void props.reconnect(server.name).catch(() => undefined)}>{copy.runtime.reconnectSession}</button></div>{server.status === "needs-auth" ? <form onSubmit={(event) => { event.preventDefault(); const value = callbacks[server.name] ?? ""; if (value) void props.submitCallback(server.name, value).then(() => setCallbacks({ ...callbacks, [server.name]: "" }), () => undefined); }}><label>{copy.runtime.callbackUrl}<input value={callbacks[server.name] ?? ""} onChange={(event) => setCallbacks({ ...callbacks, [server.name]: event.currentTarget.value })} /></label><button className="button ghost" type="submit">{copy.runtime.submitCallback}</button></form> : null}</article>)}</div>;
}
