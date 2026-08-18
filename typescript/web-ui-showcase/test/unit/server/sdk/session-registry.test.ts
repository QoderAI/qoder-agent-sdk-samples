import { describe, expect, it, vi } from "vitest";
import {
  SessionRegistry,
} from "../../../../src/server/sdk/session-registry.js";
import type { SessionController } from "../../../../src/server/sdk/session-controller.js";

const sessionId = "00000000-0000-4000-8000-000000000611";

function controller(): SessionController {
  return {
    close: vi.fn(async () => undefined),
  } as unknown as SessionController;
}

describe("SessionRegistry", () => {
  it("lets guarded commands overlap while a later exclusive operation waits for them", async () => {
    const registry = new SessionRegistry();
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond: (() => void) | undefined;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = registry.runGuarded(sessionId, async () => {
      started.push("first");
      await firstGate;
    });
    const second = registry.runGuarded(sessionId, async () => {
      started.push("second");
      await secondGate;
    });
    await vi.waitFor(() => expect(started).toEqual(["first", "second"]));

    const terminal = registry.runExclusive(sessionId, async () => {
      started.push("terminal");
    });
    await Promise.resolve();
    expect(started).toEqual(["first", "second"]);

    releaseFirst?.();
    await first;
    expect(started).toEqual(["first", "second"]);
    releaseSecond?.();
    await Promise.all([second, terminal]);
    expect(started).toEqual(["first", "second", "terminal"]);
  });

  it("queues a guarded command submitted after an exclusive operation", async () => {
    const registry = new SessionRegistry();
    const started: string[] = [];
    let releaseTerminal: (() => void) | undefined;
    const terminalGate = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const terminal = registry.runExclusive(sessionId, async () => {
      started.push("terminal");
      await terminalGate;
    });
    const guarded = registry.runGuarded(sessionId, async () => {
      started.push("guarded");
    });

    await vi.waitFor(() => expect(started).toEqual(["terminal"]));
    releaseTerminal?.();
    await Promise.all([terminal, guarded]);
    expect(started).toEqual(["terminal", "guarded"]);
  });

  it("serializes operations for one Session without blocking another Session", async () => {
    const registry = new SessionRegistry();
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let releaseSecond: (() => void) | undefined;
    const secondCanFinish = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const first = registry.runExclusive(sessionId, async () => {
      started.push("first");
      await firstCanFinish;
    });
    const second = registry.runExclusive(sessionId, async () => {
      started.push("second");
    });
    const other = registry.runExclusive(
      "00000000-0000-4000-8000-000000000612",
      async () => {
        started.push("other");
        await secondCanFinish;
      },
    );

    await vi.waitFor(() => expect(started).toEqual(["first", "other"]));
    releaseFirst?.();
    releaseSecond?.();
    await Promise.all([first, second, other]);
    expect(started).toEqual(["first", "other", "second"]);
  });

  it("reserves one controller and releases only that owner", () => {
    const registry = new SessionRegistry();
    const first = controller();
    const release = registry.reserve(sessionId, first);

    expect(registry.get(sessionId)).toBe(first);
    expect(() => registry.reserve(sessionId, controller())).toThrow(
      expect.objectContaining({ code: "SESSION_ALREADY_LIVE" }),
    );
    release();
    release();
    expect(registry.get(sessionId)).toBeUndefined();
  });

  it("closes every live controller before reporting aggregate failure", async () => {
    const registry = new SessionRegistry();
    const first = controller();
    const second = controller();
    vi.mocked(second.close).mockRejectedValue(new Error("close failed"));
    registry.reserve(sessionId, first);
    registry.reserve(
      "00000000-0000-4000-8000-000000000612",
      second,
    );

    await expect(registry.closeAll("shutdown")).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(first.close).toHaveBeenCalledWith("shutdown");
    expect(second.close).toHaveBeenCalledWith("shutdown");
  });

  it("queues shutdown close behind in-flight lifecycle work", async () => {
    const registry = new SessionRegistry();
    const live = controller();
    registry.reserve(sessionId, live);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lifecycle = registry.runExclusive(sessionId, async () => gate);

    const shutdown = registry.closeAll("shutdown");
    await Promise.resolve();
    expect(live.close).not.toHaveBeenCalled();

    release?.();
    await Promise.all([lifecycle, shutdown]);
    expect(live.close).toHaveBeenCalledOnce();
  });

  it("drains a lifecycle tail that reserves its controller after shutdown starts", async () => {
    const registry = new SessionRegistry();
    const live = controller();
    let releaseLifecycle: (() => void) | undefined;
    const lifecycleGate = new Promise<void>((resolve) => {
      releaseLifecycle = resolve;
    });
    let releaseReservation: (() => void) | undefined;
    vi.mocked(live.close).mockImplementation(async () => {
      releaseReservation?.();
    });
    const lifecycle = registry.runExclusive(sessionId, async () => {
      await lifecycleGate;
      releaseReservation = registry.reserve(sessionId, live);
    });

    let shutdownSettled = false;
    const shutdown = registry.closeAll("shutdown").finally(() => {
      shutdownSettled = true;
    });
    expect(() =>
      registry.runExclusive(
        "00000000-0000-4000-8000-000000000613",
        async () => undefined,
      ),
    ).toThrow(expect.objectContaining({ code: "SERVER_SHUTTING_DOWN" }));
    expect(() =>
      registry.reserve(
        "00000000-0000-4000-8000-000000000614",
        controller(),
      ),
    ).toThrow(expect.objectContaining({ code: "SERVER_SHUTTING_DOWN" }));
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    releaseLifecycle?.();
    await Promise.all([lifecycle, shutdown]);
    expect(live.close).toHaveBeenCalledOnce();
    expect(registry.list()).toEqual([]);
  });

  it("closes the replacement installed by lifecycle work queued before shutdown", async () => {
    const registry = new SessionRegistry();
    const oldController = controller();
    const replacement = controller();
    const releaseOldReservation = registry.reserve(sessionId, oldController);
    let finishOldClose: (() => void) | undefined;
    const oldCloseGate = new Promise<void>((resolve) => {
      finishOldClose = resolve;
    });
    vi.mocked(oldController.close).mockImplementation(async () => {
      await oldCloseGate;
      releaseOldReservation();
    });
    let releaseReplacement: (() => void) | undefined;
    vi.mocked(replacement.close).mockImplementation(async () => {
      releaseReplacement?.();
    });
    const restart = registry.runExclusive(sessionId, async () => {
      await oldController.close("restart");
      releaseReplacement = registry.reserve(sessionId, replacement);
    });
    await vi.waitFor(() => expect(oldController.close).toHaveBeenCalledOnce());

    const shutdown = registry.closeAll("shutdown");
    finishOldClose?.();
    await Promise.all([restart, shutdown]);

    expect(replacement.close).toHaveBeenCalledWith("shutdown");
    expect(registry.list()).toEqual([]);
  });
});
