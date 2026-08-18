import type { WireError } from "../../shared/errors.js";

function isProtocolVersionMismatch(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "ProtocolVersionMismatchError") {
    return false;
  }
  const candidate = error as Error & Record<string, unknown>;
  return (
    typeof candidate.cliProtocolVersion === "string" &&
    typeof candidate.sdkProtocolVersion === "string"
  );
}

export type AppErrorInput = {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(input: AppErrorInput, options?: ErrorOptions) {
    super(input.message, options);
    this.name = "AppError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
    if (input.details !== undefined) {
      this.details = input.details;
    }
  }
}

export function toWireError(error: unknown): WireError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (isProtocolVersionMismatch(error)) {
    return {
      code: "SDK_PROTOCOL_VERSION_MISMATCH",
      message: "SDK 与本地 Qoder CLI 的协议版本不兼容。",
      retryable: false,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The local server could not complete the request.",
    retryable: false,
  };
}
