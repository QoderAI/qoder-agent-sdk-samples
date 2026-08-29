import { describe, expect, it, vi } from "vitest";
import { InputQueue } from "../../../../src/server/sdk/input-queue.js";

const firstUuid = "00000000-0000-4000-8000-000000000201";

describe("InputQueue", () => {
  it("yields SDK user messages with delivery controls", async () => {
    const onStateChange = vi.fn();
    const queue = new InputQueue({
      createUuid: () => firstUuid,
      onStateChange,
    });
    const queued = queue.enqueue({
      text: "Check tests",
      priority: "later",
      shouldQuery: false,
    });

    expect(queued).toEqual({
      text: "Check tests",
      uuid: firstUuid,
      priority: "later",
      shouldQuery: false,
      state: "buffered",
    });
    expect(await queue[Symbol.asyncIterator]().next()).toEqual({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "Check tests" }],
        },
        parent_tool_use_id: null,
        priority: "later",
        shouldQuery: false,
        uuid: firstUuid,
      },
    });
    expect(queue.list()).toEqual([
      expect.objectContaining({ uuid: firstUuid, state: "delivered" }),
    ]);
    expect(onStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ uuid: firstUuid, state: "delivered" }),
    );
  });

  it("cancels only messages the SDK has not received", async () => {
    const queue = new InputQueue({ createUuid: () => firstUuid });
    queue.enqueue({ text: "Later", priority: "next", shouldQuery: true });

    expect(queue.cancelBuffered(firstUuid)).toBe(true);
    expect(queue.list()).toEqual([]);

    const deliveredQueue = new InputQueue({ createUuid: () => firstUuid });
    deliveredQueue.enqueue({
      text: "Now",
      priority: "now",
      shouldQuery: true,
    });
    await deliveredQueue[Symbol.asyncIterator]().next();
    expect(deliveredQueue.cancelBuffered(firstUuid)).toBe(false);
  });

  it("ends a waiting iterator and rejects future input after close", async () => {
    const queue = new InputQueue({ createUuid: () => firstUuid });
    const pending = queue[Symbol.asyncIterator]().next();

    queue.close();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(() =>
      queue.enqueue({ text: "Too late", priority: "next", shouldQuery: true }),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
  });

  it("removes every visible input before closing", async () => {
    const secondUuid = "00000000-0000-4000-8000-000000000202";
    const ids = [firstUuid, secondUuid];
    const onStateChange = vi.fn();
    const queue = new InputQueue({
      createUuid: () => ids.shift() ?? crypto.randomUUID(),
      onStateChange,
    });
    queue.enqueue({ text: "Delivered", priority: "now", shouldQuery: true });
    await queue[Symbol.asyncIterator]().next();
    queue.enqueue({ text: "Buffered", priority: "later", shouldQuery: false });

    queue.close();

    expect(queue.list()).toEqual([]);
    expect(onStateChange.mock.calls.map(([change]) => change)).toEqual(
      expect.arrayContaining([
        { uuid: firstUuid, removed: true },
        { uuid: secondUuid, removed: true },
      ]),
    );
  });

  it("rejects concurrent iterator waiters", async () => {
    const queue = new InputQueue({ createUuid: () => firstUuid });
    const iterator = queue[Symbol.asyncIterator]();
    const first = iterator.next();

    await expect(iterator.next()).rejects.toMatchObject({
      code: "INPUT_QUEUE_CONCURRENT_WAIT",
    });
    queue.close();
    await expect(first).resolves.toMatchObject({ done: true });
  });
});
