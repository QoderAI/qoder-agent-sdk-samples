import { describe, expect, it, vi } from "vitest";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";

const firstWorkspaceId = "00000000-0000-4000-8000-000000000001";
const secondWorkspaceId = "00000000-0000-4000-8000-000000000002";

describe("EventJournal", () => {
  it("assigns monotonic sequences and replays after a cursor", () => {
    const journal = new EventJournal({
      epoch: "epoch-a",
      capacity: 3,
      now: () => "2026-08-14T08:00:00.000Z",
    });
    journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: firstWorkspaceId },
    });
    const second = journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: secondWorkspaceId },
    });

    expect(second.sequence).toBe(2);
    expect(journal.replay({ epoch: "epoch-a", after: 1 })).toEqual({
      kind: "events",
      events: [second],
    });
  });

  it("requires a snapshot for an old epoch or expired cursor", () => {
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 1 });
    journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: firstWorkspaceId },
    });
    journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: secondWorkspaceId },
    });

    expect(journal.replay({ epoch: "epoch-b", after: 1 })).toEqual({
      kind: "snapshot-required",
    });
    expect(journal.replay({ epoch: "epoch-a", after: 0 })).toEqual({
      kind: "snapshot-required",
    });
  });

  it("stores an event before notifying subscribers", () => {
    const journal = new EventJournal({ epoch: "epoch-a", capacity: 2 });
    const listener = vi.fn(() => {
      expect(journal.cursor()).toBe(1);
    });
    const unsubscribe = journal.subscribe(listener);

    journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: firstWorkspaceId },
    });
    unsubscribe();
    unsubscribe();
    journal.publish({
      type: "workspace.removed",
      payload: { workspaceId: secondWorkspaceId },
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
