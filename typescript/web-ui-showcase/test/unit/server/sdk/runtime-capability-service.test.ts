import { describe, expect, it, vi } from "vitest";
import { RuntimeCapabilityService } from "../../../../src/server/sdk/runtime-capability-service.js";

const sessionId = "00000000-0000-4000-8000-000000000902";

function setup(picked: string | null) {
  const service = new RuntimeCapabilityService({
    journal: { publish: vi.fn() } as never,
    registry: {
      runGuarded: (_id: string, run: () => Promise<void>) => run(),
    } as never,
    runtimeState: { snapshot: vi.fn(() => ({})), merge: vi.fn() } as never,
    mcp: {} as never,
    refreshSessionMetadata: vi.fn(),
    picker: { pick: vi.fn(async () => picked) },
  });
  return {
    service,
    addDirectories: vi
      .spyOn(service, "addDirectories")
      .mockResolvedValue(undefined),
  };
}

describe("RuntimeCapabilityService pickAndAddDirectory", () => {
  it("delegates a picked directory to addDirectories", async () => {
    const { service, addDirectories } = setup("/repo/packages/lib");
    await service.pickAndAddDirectory(sessionId);
    expect(addDirectories).toHaveBeenCalledWith(sessionId, ["/repo/packages/lib"]);
  });

  it("adds nothing when the picker is cancelled", async () => {
    const { service, addDirectories } = setup(null);
    await service.pickAndAddDirectory(sessionId);
    expect(addDirectories).not.toHaveBeenCalled();
  });
});
