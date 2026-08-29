import { Component, type ReactNode } from "react";
import qoderIconUrl from "../../assets/qoder-icon-128.png";
import { copy } from "../../i18n/zh-cn.js";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <main className="fatal-fallback"><img className="empty-orb" src={qoderIconUrl} alt="" width={42} height={42} /><h1>{copy.error.renderInterface}</h1><p>{copy.error.sessionPreserved}</p><button className="button primary" type="button" onClick={() => window.location.reload()}>{copy.error.reloadInterface}</button></main>;
  }
}
