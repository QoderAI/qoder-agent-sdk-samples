import { useAppState, useAppStore } from "../../store/store-context.js";
import { copy } from "../../i18n/zh-cn.js";

export function ErrorBanner(props: {
  reloadSnapshot: () => void;
}): JSX.Element | null {
  const state = useAppState();
  const store = useAppStore();
  const error = state.protocolError;
  if (error === null && state.connectionState !== "disconnected") return null;
  return <aside className="error-banner" role="alert"><div><strong>{error?.code ?? copy.common.reconnecting}</strong><span>{error?.message ?? copy.error.realtimeRetry}</span></div><div>{error?.code === "PROTOCOL_ERROR" ? <button type="button" className="button ghost" onClick={props.reloadSnapshot}>{copy.error.reloadSnapshot}</button> : null}{error === null ? null : <button type="button" className="button ghost" onClick={() => store.dismissProtocolError()}>{copy.error.dismiss}</button>}</div></aside>;
}
