import { describe, expect, it } from "vitest";
import {
  composerCommandViewSchema,
  sessionRuntimeViewSchema,
} from "../../../src/shared/model.js";

describe("ComposerCommandView", () => {
  it("accepts only commands with a released execution strategy", () => {
    expect(
      composerCommandViewSchema.parse({
        name: "model",
        description: "选择 Model",
        argumentHint: "<model>",
        execution: "model-control",
      }),
    ).toEqual({
      name: "model",
      description: "选择 Model",
      argumentHint: "<model>",
      execution: "model-control",
    });

    expect(
      composerCommandViewSchema.safeParse({
        name: "unsafe",
        description: "Unsupported interactive dialog",
        argumentHint: "",
        execution: "custom-dialog",
      }).success,
    ).toBe(false);
  });
});

describe("Session runtime Context status", () => {
  it("accepts only the released Context lifecycle states", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000901",
      currentModel: null,
      currentPermissionMode: "default" as const,
      capabilities: [],
      hooks: [],
      rawEvents: [],
      errors: [],
    };

    for (const contextStatus of ["loading", "ready", "unsupported"] as const) {
      expect(
        sessionRuntimeViewSchema.parse({ ...base, contextStatus }).contextStatus,
      ).toBe(contextStatus);
    }
    expect(
      sessionRuntimeViewSchema.safeParse({ ...base, contextStatus: "failed" })
        .success,
    ).toBe(false);
  });

  it("requires authoritative Model and Permission selections", () => {
    const base = {
      sessionId: "00000000-0000-4000-8000-000000000901",
      capabilities: [],
      hooks: [],
      rawEvents: [],
      errors: [],
    };

    expect(sessionRuntimeViewSchema.parse({
      ...base,
      currentModel: "performance",
      currentPermissionMode: "acceptEdits",
    })).toMatchObject({
      currentModel: "performance",
      currentPermissionMode: "acceptEdits",
    });
    expect(sessionRuntimeViewSchema.parse({
      ...base,
      currentModel: null,
      currentPermissionMode: "auto",
    }).currentModel).toBeNull();
    expect(sessionRuntimeViewSchema.safeParse({
      ...base,
      currentModel: "performance",
      currentPermissionMode: "plan",
    }).success).toBe(false);
    expect(sessionRuntimeViewSchema.safeParse(base).success).toBe(false);
  });
});
