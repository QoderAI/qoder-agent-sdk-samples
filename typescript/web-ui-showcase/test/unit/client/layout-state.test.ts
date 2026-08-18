import { describe, expect, it } from "vitest";
import {
  computeColumns,
  CENTER_MIN,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "../../../src/client/features/layout/columns.js";
import { AppStore } from "../../../src/client/store/app-store.js";

const sessionA = "00000000-0000-4000-8000-000000000c01";
const sessionB = "00000000-0000-4000-8000-000000000c02";

describe("DSH layout state", () => {
  it("allocates the default sidebar, center target, and details width", () => {
    expect(computeColumns(1280, 280, 360)).toEqual({
      sidebar: 280,
      center: 640,
      details: 360,
    });
  });

  it("keeps details closed when its preferred width is zero", () => {
    expect(computeColumns(1280, 280, 0)).toEqual({
      sidebar: 280,
      center: 1000,
      details: 0,
    });
  });

  it("closes details before reducing the center below its target", () => {
    expect(computeColumns(1000, 280, 360)).toEqual({
      sidebar: 280,
      center: 720,
      details: 0,
    });
  });

  it("shrinks details to its minimum while retaining the center target", () => {
    expect(computeColumns(1220, SIDEBAR_DEFAULT, DETAILS_DEFAULT)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      details: 300,
    });
  });

  it("clears contextual details only when switching Sessions", () => {
    const store = new AppStore();
    const selection = { kind: "task" as const, sessionId: sessionA, taskId: "task-1" };

    store.selectSession(sessionA);
    store.openDetails(selection);
    store.selectSession(sessionA);
    expect(store.getState().detailsSelection).toEqual(selection);

    store.selectSession(sessionB);
    expect(store.getState().detailsSelection).toBeNull();
  });

  it("keeps panel preferences when details are closed", () => {
    const store = new AppStore();

    store.toggleSidebar();
    store.openSdkConsole();
    store.openSettings();
    store.openDetails({ kind: "task", sessionId: sessionA, taskId: "task-1" });
    store.closeDetails();

    expect(store.getState()).toMatchObject({
      sidebarWidth: 56,
      preferredDetailsWidth: DETAILS_DEFAULT,
      detailsSelection: null,
      sdkConsoleOpen: true,
      settingsOpen: true,
    });
  });

  it("clamps pointer-resized panel preferences to their usable ranges", () => {
    const store = new AppStore();

    store.setSidebarWidth(0);
    expect(store.getState().sidebarWidth).toBe(SIDEBAR_MIN);
    store.setSidebarWidth(10_000);
    expect(store.getState().sidebarWidth).toBe(SIDEBAR_MAX);

    store.setPreferredDetailsWidth(0);
    expect(store.getState().preferredDetailsWidth).toBe(DETAILS_MIN);
    store.setPreferredDetailsWidth(10_000);
    expect(store.getState().preferredDetailsWidth).toBe(DETAILS_MAX);
  });
});
