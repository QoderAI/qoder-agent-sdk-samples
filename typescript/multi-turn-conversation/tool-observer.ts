type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

export function preview(value: unknown): string {
  const text =
    typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

interface ToolView {
  id: string;
  name: string;
  input: unknown;
  root?: string;
  agent?: string;
  phase: string;
  result?: RecordValue;
  note?: string;
}

/** 仅维护终端展示；不把宿主事件写回 SDK 输入或另存为会话历史。 */
export class ToolObserver {
  private readonly calls = new Map<string, ToolView>();

  constructor(private readonly write: (line: string) => void) {}

  private show(call: ToolView): void {
    this.write(
      `[tool ${call.id}] ${call.name} ${call.phase}` +
        (call.root ? ` codeMode=${call.root}` : "") +
        (call.agent ? ` agent=${call.agent}` : "") +
        `\n  ${preview(call.result ?? call.input)}` +
        (call.note ? `\n  script: ${call.note}` : ""),
    );
  }

  observe(value: unknown, replay = false): boolean {
    const message = record(value);
    if (!message) return false;
    const host = message.message_source === "host_tool";
    const root =
      typeof message.code_mode_tool_use_id === "string"
        ? message.code_mode_tool_use_id
        : undefined;
    const agent =
      typeof message.parent_tool_use_id === "string"
        ? message.parent_tool_use_id
        : undefined;
    if (message.type === "tool_progress") {
      const call = this.calls.get(String(message.tool_use_id));
      if (call && !call.result && call.phase !== "unfinished") {
        call.phase = "running";
        if (!replay)
          this.write(
            `[progress ${call.id}] ${preview(message.mcp ?? message.output ?? `${message.elapsed_time_seconds}s`)}`,
          );
      }
      return true;
    }
    const content = record(message.message)?.content;
    if (!Array.isArray(content)) return host;
    const results = content.filter(
      (block) => record(block)?.type === "tool_result",
    );
    let resultIndex = 0;
    for (const item of content) {
      const block = record(item);
      if (!block) continue;
      if (
        message.type === "assistant" &&
        block.type === "tool_use" &&
        typeof block.id === "string"
      ) {
        if (!this.calls.has(block.id)) {
          const call: ToolView = {
            id: block.id,
            name: String(block.name),
            input: block.input,
            root,
            agent,
            phase: "pending",
          };
          this.calls.set(call.id, call);
          if (!replay) this.show(call);
        }
      } else if (message.type === "user" && block.type === "tool_result") {
        // 原生历史消息可能包含多个结果，side-channel 与结果块按下标对应。
        const side =
          results.length > 1 && Array.isArray(message.tool_use_result)
            ? message.tool_use_result[resultIndex]
            : message.tool_use_result;
        resultIndex++;
        const call = this.calls.get(String(block.tool_use_id));
        if (call && !call.result) {
          call.result = {
            content: block.content,
            is_error: block.is_error,
            tool_use_result: side,
            tool_result_meta: Array.isArray(message.tool_result_meta)
              ? message.tool_result_meta.filter(
                  (meta) => record(meta)?.id === block.tool_use_id,
                )
              : undefined,
          };
          call.phase = block.is_error === true ? "failed" : "completed";
          if (!replay) this.show(call);
        }
        this.mergeCodeMode(side, agent, replay);
      }
    }
    return host;
  }

  private mergeCodeMode(
    value: unknown,
    agent: string | undefined,
    replay: boolean,
  ): void {
    const result = record(value);
    if (
      result?.type !== "code_mode" ||
      typeof result.rootToolUseId !== "string" ||
      !Array.isArray(result.calls)
    )
      return;
    for (const value of result.calls) {
      const child = record(value);
      if (
        !child ||
        typeof child.callId !== "string" ||
        typeof child.name !== "string"
      )
        continue;
      const call = this.calls.get(child.callId) ?? {
        id: child.callId,
        name: child.name,
        input: child.args,
        root: result.rootToolUseId,
        agent,
        phase: "pending",
      };
      const hadResult = Boolean(call.result);
      const hostResult = record(child.hostResult);
      if (hostResult && !hadResult) {
        call.result = hostResult;
        call.phase = hostResult.is_error === true ? "failed" : "completed";
      } else if (!hadResult && child.status !== "pending") {
        call.phase = `summary: ${child.status}`;
      }
      // 脚本交付失败与原生执行结果分别展示；历史参数预览不覆盖实时完整参数。
      const note = typeof child.error === "string" ? child.error : call.note;
      const changedNote = note !== call.note;
      call.note = note;
      this.calls.set(call.id, call);
      if (!replay && ((!hadResult && hostResult) || changedNote))
        this.show(call);
    }
  }

  permission(id: string, waiting: boolean): void {
    const call = this.calls.get(id);
    if (call && !call.result && call.phase !== "unfinished")
      call.phase = waiting ? "awaiting permission" : "pending";
  }

  finish(): void {
    for (const call of this.calls.values()) {
      if (
        !call.result &&
        ["pending", "running", "awaiting permission"].includes(call.phase)
      )
        call.phase = "unfinished";
    }
  }

  restore(messages: readonly unknown[]): void {
    this.calls.clear();
    for (const message of messages) this.observe(message, true);
    this.finish();
    this.print();
  }

  print(): void {
    if (!this.calls.size) this.write("[tools] No tool calls recorded.");
    for (const call of this.calls.values()) this.show(call);
  }
}
