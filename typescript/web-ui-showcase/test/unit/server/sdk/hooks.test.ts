import { describe, expect, it, vi } from "vitest";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import { createShowcaseHooks } from "../../../../src/server/sdk/hooks.js";
import { SessionRuntimeState } from "../../../../src/server/sdk/session-runtime-state.js";

const sessionId = "00000000-0000-4000-8000-000000000901";
const base = {
  session_id: sessionId,
  transcript_path: "/repo/transcript.jsonl",
  cwd: "/repo",
};

describe("showcase Hooks", () => {
  it("adds Session context and observes redacted events without authorizing", async () => {
    const journal = new EventJournal({ epoch: "epoch-hooks", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });
    const onToolRunning = vi.fn();
    const hooks = createShowcaseHooks({
      sessionId: () => sessionId,
      runtimeState,
      onToolRunning,
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const signal = new AbortController().signal;

    const started = await hooks.SessionStart?.[0]?.hooks[0]?.(
      { ...base, hook_event_name: "SessionStart", source: "startup" },
      undefined,
      { signal },
    );
    const beforeTool = await hooks.PreToolUse?.[0]?.hooks[0]?.(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pwd", access_token: "secret" },
        tool_use_id: "tool-1",
      },
      "tool-1",
      { signal },
    );

    expect(started).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("local Qoder Agent SDK"),
      },
    });
    expect(beforeTool).toEqual({});
    expect(onToolRunning).toHaveBeenCalledOnce();
    expect(onToolRunning).toHaveBeenCalledWith("tool-1");
    expect(runtimeState.snapshot(sessionId).hooks).toMatchObject([
      { event: "SessionStart" },
      {
        event: "PreToolUse",
        toolName: "Bash",
        input: { command: "pwd", access_token: "[REDACTED]" },
      },
    ]);
  });

  it("stores an oversized Hook input as one redacted byte-bounded entry", async () => {
    const journal = new EventJournal({ epoch: "epoch-large-hook", capacity: 100 });
    const runtimeState = new SessionRuntimeState({ journal });
    const hooks = createShowcaseHooks({
      sessionId: () => sessionId,
      runtimeState,
      onToolRunning: vi.fn(),
      now: () => "2026-08-14T08:00:00.000Z",
    });
    const secret = "hook-tool-secret";

    await hooks.PreToolUse?.[0]?.hooks[0]?.(
      {
        ...base,
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: {
          accessToken: secret,
          content: "界".repeat(16_384),
        },
        tool_use_id: "tool-large",
      },
      "tool-large",
      { signal: new AbortController().signal },
    );

    const entry = runtimeState.snapshot(sessionId).hooks[0];
    const serialized = JSON.stringify(entry);
    expect(entry).toMatchObject({
      __qoderDiagnostic: {
        kind: "truncated",
        maxBytes: 16_384,
      },
    });
    expect(new TextEncoder().encode(serialized).length).toBeLessThanOrEqual(16_384);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
  });
});
