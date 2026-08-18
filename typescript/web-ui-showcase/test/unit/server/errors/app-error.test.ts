import { describe, expect, it } from "vitest";
import {
  AppError,
  toWireError,
} from "../../../../src/server/errors/app-error.js";

describe("AppError", () => {
  it("projects only explicitly safe fields", () => {
    const error = new AppError(
      {
        code: "WORKSPACE_PATH_MISSING",
        message: "The selected path does not exist.",
        status: 404,
        retryable: true,
        details: { pathKind: "missing" },
      },
      { cause: new Error("secret stack") },
    );

    expect(toWireError(error)).toEqual({
      code: "WORKSPACE_PATH_MISSING",
      message: "The selected path does not exist.",
      retryable: true,
      details: { pathKind: "missing" },
    });
  });

  it("uses a fixed error for unknown failures", () => {
    expect(toWireError(new Error("database password=secret"))).toEqual({
      code: "INTERNAL_ERROR",
      message: "The local server could not complete the request.",
      retryable: false,
    });
  });
});
