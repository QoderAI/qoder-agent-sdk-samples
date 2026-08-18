import { Component, type ReactNode } from "react";
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
    return <main className="fatal-fallback"><div className="empty-orb">Q</div><h1>{copy.error.renderInterface}</h1><p>{copy.error.sessionPreserved}</p><button className="button primary" type="button" onClick={() => window.location.reload()}>{copy.error.reloadInterface}</button></main>;
  }
}
