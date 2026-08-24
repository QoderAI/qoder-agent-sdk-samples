import type {
  HookCallback,
  HookJSONOutput,
  Options,
} from "@qoder-ai/qoder-agent-sdk";
import { redactForBrowser } from "./redact.js";
import type { SessionRuntimeState } from "./session-runtime-state.js";

/** Creates observational Hooks that never grant or deny tool permission. */
export function createShowcaseHooks(input: {
  sessionId: () => string;
  runtimeState: SessionRuntimeState;
  onToolRunning: (toolUseId: string) => void;
  now?: () => string;
}): NonNullable<Options["hooks"]> {
  const now = input.now ?? (() => new Date().toISOString());
  const observe: HookCallback = async (hookInput): Promise<HookJSONOutput> => {
    const observation: Record<string, unknown> = {
      source: "callback",
      phase: "observation",
      event: hookInput.hook_event_name,
      occurredAt: now(),
    };
    if ("tool_name" in hookInput) {
      observation.toolName = hookInput.tool_name;
    }
    if ("tool_input" in hookInput) {
      observation.input = redactForBrowser(hookInput.tool_input);
    }
    if (hookInput.hook_event_name === "PreToolUse") {
      input.onToolRunning(hookInput.tool_use_id);
    }
    input.runtimeState.merge(input.sessionId(), { hooks: [observation] });
    if (hookInput.hook_event_name === "SessionStart") {
      return {
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            "This Session is running inside the local Qoder Agent SDK Web UI showcase.",
        },
      };
    }
    return {};
  };

  const matcher = { hooks: [observe] };
  return {
    SessionStart: [matcher],
    UserPromptSubmit: [matcher],
    PreToolUse: [matcher],
    PostToolUse: [matcher],
    Stop: [matcher],
  };
}
