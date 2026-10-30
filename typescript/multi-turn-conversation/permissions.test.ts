import assert from "node:assert/strict";
import test from "node:test";
import { Permissions } from "./permissions.js";
import { ToolObserver } from "./tool-observer.js";

test("并行权限独立结算，查询取消会清理剩余请求", async () => {
  const lines: string[] = [];
  const permissions = new Permissions(new ToolObserver(() => {}), (line) =>
    lines.push(line),
  );
  const controller = new AbortController();
  const first = permissions.canUseTool(
    "Read",
    { file_path: "a" },
    { toolUseID: "a", signal: controller.signal },
  );
  const second = permissions.canUseTool(
    "Read",
    { file_path: "b" },
    { toolUseID: "b", signal: controller.signal },
  );
  permissions.answer("a", true);
  assert.deepEqual(await first, {
    behavior: "allow",
    updatedInput: { file_path: "a" },
  });
  let secondDone = false;
  void second.then(() => {
    secondDone = true;
  });
  await Promise.resolve();
  assert.equal(secondDone, false);
  controller.abort();
  assert.equal((await second).behavior, "deny");
  permissions.answer("b", true);
  assert.match(lines.at(-1)!, /No pending request/);
});

test("关闭时拒绝待处理请求，不扩大只读工具范围", async () => {
  const permissions = new Permissions(new ToolObserver(() => {}), () => {});
  const options = { toolUseID: "a", signal: new AbortController().signal };
  assert.equal(
    (await permissions.canUseTool("Bash", { command: "pwd" }, options))
      .behavior,
    "deny",
  );
  const pending = permissions.canUseTool("Glob", { pattern: "*" }, options);
  permissions.cancel();
  assert.equal((await pending).behavior, "deny");
});
