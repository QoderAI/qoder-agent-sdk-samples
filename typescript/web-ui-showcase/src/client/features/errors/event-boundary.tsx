import { Component, type ErrorInfo, type ReactNode } from "react";
import type { ConversationItem } from "../../../shared/model.js";
import { SafeJson } from "../../components/safe-json.js";
import { copy } from "../../i18n/zh-cn.js";

export class EventBoundary extends Component<
  { fallbackPayload: ConversationItem; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {}

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <article className="message-card error" aria-label={copy.error.renderEvent}>
        <strong>{copy.error.renderEvent}</strong>
        <SafeJson value={this.props.fallbackPayload} />
      </article>
    );
  }
}
