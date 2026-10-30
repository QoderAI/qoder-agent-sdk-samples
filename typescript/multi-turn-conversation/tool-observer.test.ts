import assert from "node:assert/strict";
import test from "node:test";
import { ToolObserver } from "./tool-observer.js";

const use = (id: string) => ({
  type: "assistant",
  message_source: "host_tool",
  code_mode_tool_use_id: "exec",
  parent_tool_use_id: "agent",
  message: {
    content: [{ type: "tool_use", id, name: "Read", input: { file_path: id } }],
  },
});
const result = (id: string, content: string, is_error = false) => ({
  ...use(id),
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content, is_error }],
  },
  tool_use_result: { value: content },
});
const aggregate = (id: string, calls: unknown[]) => ({
  type: "user",
  parent_tool_use_id: "agent",
  message: {
    content: [{ type: "tool_result", tool_use_id: id, content: "report" }],
  },
  tool_use_result: {
    type: "code_mode",
    rootToolUseId: "exec",
    callsMode: "delta",
    calls,
  },
});

test("并行同名调用按 ID 归属，子结果不结束另一条调用，迟到进度不复活终态", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  assert.equal(tools.observe(use("a")), true);
  tools.observe(use("b"));
  tools.permission("b", true);
  tools.observe(result("a", "output-a"));
  tools.observe({
    type: "tool_progress",
    tool_use_id: "b",
    mcp: { progress: 1, total: 2 },
  });
  tools.observe(result("b", "denied", true));
  const count = lines.length;
  tools.observe({
    type: "tool_progress",
    tool_use_id: "a",
    elapsed_time_seconds: 9,
  });
  tools.observe(result("a", "output-a"));
  assert.equal(lines.length, count);
  assert.match(
    lines.join("\n"),
    /a\] Read completed codeMode=exec agent=agent/,
  );
  assert.match(lines.join("\n"), /b\] Read failed codeMode=exec agent=agent/);
});

test("历史合并 CodeMode 和多次 Wait 的增量，保留先前结果与首次调用顺序", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  tools.restore([
    aggregate("exec", [
      {
        callId: "a",
        name: "Read",
        status: "completed",
        hostResult: { content: "output-a" },
      },
      { callId: "b", name: "Read", status: "pending" },
    ]),
    aggregate("wait-1", []),
    aggregate("wait-2", [
      {
        callId: "b",
        name: "Read",
        status: "error",
        error: "delivery failed",
        hostResult: { content: "output-b", is_error: false },
      },
      { callId: "unfinished", name: "Read", status: "pending" },
    ]),
  ]);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /a\] Read completed/);
  assert.match(lines[1], /b\] Read completed/);
  assert.match(lines[1], /script: delivery failed/);
  assert.match(lines[2], /unfinished\] Read unfinished/);
  assert.match(lines.join("\n"), /output-a/);
  assert.match(lines.join("\n"), /output-b/);
});

test("聚合结果不重复输出实时终态，待执行摘要不覆盖完整输入或成功结果", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  tools.observe(use("a"));
  tools.observe(result("a", "live"));
  const count = lines.length;
  tools.observe(
    aggregate("wait", [
      {
        callId: "a",
        name: "Read",
        args: { truncated: true },
        status: "pending",
      },
    ]),
  );
  assert.equal(lines.length, count);
  tools.print();
  assert.match(lines.at(-1)!, /completed/);
  assert.match(lines.at(-1)!, /live/);
});

test("一条历史消息内的多个父工具结果使用各自的 side-channel", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  const a = aggregate("exec", [
    {
      callId: "a",
      name: "Read",
      status: "completed",
      hostResult: { content: "first" },
    },
  ]);
  const b = aggregate("wait", [
    {
      callId: "b",
      name: "Read",
      status: "completed",
      hostResult: { content: "second" },
    },
  ]);
  tools.restore([
    {
      ...a,
      message: { content: [...a.message.content, ...b.message.content] },
      tool_use_result: [a.tool_use_result, b.tool_use_result],
    },
  ]);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /first/);
  assert.match(lines[1], /second/);
});

test("同一历史消息中的拒绝元数据只关联对应工具", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  tools.restore([
    use("a"),
    use("b"),
    {
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "a", content: "done" },
          {
            type: "tool_result",
            tool_use_id: "b",
            content: "denied",
            is_error: true,
          },
        ],
      },
      tool_result_meta: [
        {
          id: "b",
          non_execution_kind: "user-rejected",
          user_feedback: "Skip this file",
        },
      ],
    },
  ]);
  assert.doesNotMatch(lines[0], /Skip this file/);
  assert.match(lines[1], /Skip this file/);
});

test("回合结束后迟到的权限撤回不会让未完成调用重新进入 pending", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  tools.observe(use("a"));
  tools.permission("a", true);
  tools.finish();
  tools.permission("a", false);
  tools.print();
  assert.match(lines.at(-1)!, /unfinished/);
});

test("CodeMode 和 Wait 的 pending 摘要保留实时权限与执行状态", () => {
  const lines: string[] = [];
  const tools = new ToolObserver((line) => lines.push(line));
  tools.observe(use("waiting"));
  tools.observe(use("running"));
  tools.permission("waiting", true);
  tools.observe({
    type: "tool_progress",
    tool_use_id: "running",
    elapsed_time_seconds: 1,
  });
  const calls = ["waiting", "running"].map((callId) => ({
    callId,
    name: "Read",
    status: "pending",
  }));
  tools.observe(aggregate("exec", calls));
  tools.observe(aggregate("wait", calls));
  tools.print();
  assert.match(lines.at(-2)!, /waiting\] Read awaiting permission/);
  assert.match(lines.at(-1)!, /running\] Read running/);
  tools.finish();
  tools.observe(aggregate("late-wait", calls));
  tools.print();
  assert.match(lines.at(-2)!, /unfinished/);
  assert.match(lines.at(-1)!, /unfinished/);
});
