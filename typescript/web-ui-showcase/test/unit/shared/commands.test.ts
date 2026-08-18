import { describe, expect, it } from "vitest";
import {
  createSessionCommandSchema,
  permissionModeSchema,
  setPermissionModeCommandSchema,
} from "../../../src/shared/commands.js";

describe("browser PermissionMode commands", () => {
  it("accepts only the PermissionMode values exposed by the browser", () => {
    expect(permissionModeSchema.options).toEqual([
      "default",
      "acceptEdits",
      "auto",
    ]);

    for (const permissionMode of permissionModeSchema.options) {
      expect(
        createSessionCommandSchema.parse({ permissionMode }),
      ).toEqual({ permissionMode });
      expect(
        setPermissionModeCommandSchema.parse({ permissionMode }),
      ).toEqual({ permissionMode });
    }

    for (const permissionMode of [
      "plan",
      "dontAsk",
      "bypassPermissions",
      "yolo",
    ]) {
      expect(
        createSessionCommandSchema.safeParse({ permissionMode }).success,
      ).toBe(false);
      expect(
        setPermissionModeCommandSchema.safeParse({ permissionMode }).success,
      ).toBe(false);
    }
  });
});
