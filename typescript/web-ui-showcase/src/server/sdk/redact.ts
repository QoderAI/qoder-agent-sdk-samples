import type { WireError } from "../../shared/errors.js";

const redactedKeys = new Set([
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "serviceaccountkey",
  "oauthcallbackurl",
  "clientsecret",
  "privatekey",
  "stack",
]);

function canonicalKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Identifies exact and environment-prefixed credential field names. */
export function isSensitiveDiagnosticKey(key: string): boolean {
  const canonical = canonicalKey(key);
  return [...redactedKeys].some(
    (candidate) =>
      canonical === candidate ||
      (candidate !== "stack" && canonical.endsWith(candidate)),
  );
}

export const SDK_CONSOLE_DIAGNOSTIC_MAX_BYTES = 16 * 1024;
export const SDK_DIAGNOSTIC_MAX_DEPTH = 32;
export const SDK_DIAGNOSTIC_MAX_NODES = 1_024;
export const SDK_BROWSER_PROJECTION_MAX_BYTES = 64 * 1_024;

type ProjectionBudget = {
  nodes: number;
  bytes: number;
  maxBytes: number;
  redactionApplied: boolean;
};

type ProjectionResult =
  | { kind: "complete"; value: unknown; redactionApplied: boolean }
  | { kind: "truncated" | "unsupported"; redactionApplied: boolean };

function consumeBytes(budget: ProjectionBudget, bytes: number): boolean {
  if (bytes > budget.maxBytes - budget.bytes) return false;
  budget.bytes += bytes;
  return true;
}

function consumeJsonString(
  value: string,
  budget: ProjectionBudget,
): boolean {
  if (!consumeBytes(budget, 2)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let bytes: number;
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes = 2;
    } else if (code <= 0x1f) {
      bytes = 6;
    } else if (code <= 0x7f) {
      bytes = 1;
    } else if (code <= 0x7ff) {
      bytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes = 4;
        index += 1;
      } else {
        bytes = 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes = 6;
    } else {
      bytes = 3;
    }
    if (!consumeBytes(budget, bytes)) return false;
  }
  return true;
}

function incomplete(
  kind: "truncated" | "unsupported",
  budget: ProjectionBudget,
): ProjectionResult {
  return { kind, redactionApplied: budget.redactionApplied };
}

function projectValue(
  value: unknown,
  ancestors: WeakSet<object>,
  budget: ProjectionBudget,
  depth: number,
): ProjectionResult {
  if (depth > SDK_DIAGNOSTIC_MAX_DEPTH) {
    return incomplete("truncated", budget);
  }
  if (budget.nodes >= SDK_DIAGNOSTIC_MAX_NODES) {
    return incomplete("truncated", budget);
  }
  budget.nodes += 1;
  if (value === null) {
    return consumeBytes(budget, 4)
      ? { kind: "complete", value: null, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value === "string") {
    return consumeJsonString(value, budget)
      ? { kind: "complete", value, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value === "boolean") {
    return consumeBytes(budget, value ? 4 : 5)
      ? { kind: "complete", value, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return consumeBytes(budget, 4)
        ? { kind: "complete", value: null, redactionApplied: budget.redactionApplied }
        : incomplete("truncated", budget);
    }
    const normalized = Object.is(value, -0) ? 0 : value;
    return consumeBytes(budget, String(normalized).length)
      ? { kind: "complete", value: normalized, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value === "bigint") {
    const normalized = value.toString();
    return consumeJsonString(normalized, budget)
      ? { kind: "complete", value: normalized, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value === "undefined") {
    return consumeBytes(budget, 4)
      ? { kind: "complete", value: null, redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  if (typeof value !== "object") return incomplete("unsupported", budget);
  if (ancestors.has(value)) {
    return consumeJsonString("[CIRCULAR]", budget)
      ? { kind: "complete", value: "[CIRCULAR]", redactionApplied: budget.redactionApplied }
      : incomplete("truncated", budget);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Array.prototype && prototype !== null) {
        return incomplete("unsupported", budget);
      }
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number" ||
        keys.some((key) => typeof key !== "string")
      ) {
        return incomplete("unsupported", budget);
      }
      const length = lengthDescriptor.value;
      if (
        keys.length !== length + 1 ||
        length > SDK_DIAGNOSTIC_MAX_NODES - budget.nodes ||
        !consumeBytes(budget, 2 + Math.max(0, length - 1))
      ) {
        return incomplete("truncated", budget);
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          return incomplete("unsupported", budget);
        }
        const entry = projectValue(
          descriptor.value,
          ancestors,
          budget,
          depth + 1,
        );
        if (entry.kind !== "complete") return entry;
        snapshot.push(entry.value);
      }
      return { kind: "complete", value: snapshot, redactionApplied: budget.redactionApplied };
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return incomplete("unsupported", budget);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > SDK_DIAGNOSTIC_MAX_NODES - budget.nodes) {
      return incomplete("truncated", budget);
    }
    const snapshot = Object.create(null) as Record<string, unknown>;
    if (!consumeBytes(budget, 2)) return incomplete("truncated", budget);
    let entries = 0;
    for (const key of keys) {
      if (typeof key !== "string") return incomplete("unsupported", budget);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) return incomplete("unsupported", budget);
      if (descriptor.enumerable !== true) continue;
      if (
        (entries > 0 && !consumeBytes(budget, 1)) ||
        !consumeJsonString(key, budget) ||
        !consumeBytes(budget, 1)
      ) {
        return incomplete("truncated", budget);
      }
      entries += 1;
      if (isSensitiveDiagnosticKey(key)) {
        budget.redactionApplied = true;
        if (!consumeJsonString("[REDACTED]", budget)) {
          return incomplete("truncated", budget);
        }
        snapshot[key] = "[REDACTED]";
        continue;
      }
      if (!("value" in descriptor)) return incomplete("unsupported", budget);
      const entry = projectValue(
        descriptor.value,
        ancestors,
        budget,
        depth + 1,
      );
      if (entry.kind !== "complete") return entry;
      snapshot[key] = entry.value;
    }
    return { kind: "complete", value: snapshot, redactionApplied: budget.redactionApplied };
  } finally {
    ancestors.delete(value);
  }
}

function projectDiagnostic(value: unknown, maxBytes: number): ProjectionResult {
  const budget: ProjectionBudget = {
    nodes: 0,
    bytes: 0,
    maxBytes,
    redactionApplied: false,
  };
  try {
    return projectValue(value, new WeakSet(), budget, 0);
  } catch {
    return incomplete("unsupported", budget);
  }
}

function diagnosticMetadata(
  kind: "truncated" | "unsupported",
  maxBytes: number,
  redactionApplied: boolean,
): Record<string, unknown> {
  return {
    kind,
    maxBytes,
    ...(kind === "truncated" ? { originalBytes: maxBytes + 1 } : {}),
    ...(redactionApplied ? { redaction: "[REDACTED]" } : {}),
  };
}

function diagnosticFallback(
  result: Exclude<ProjectionResult, { kind: "complete" }>,
  maxBytes: number,
): Record<string, unknown> {
  return {
    __qoderDiagnostic: diagnosticMetadata(
      result.kind,
      maxBytes,
      result.redactionApplied,
    ),
  };
}

/** Creates a descriptor-safe, redacted, and bounded browser value. */
export function redactForBrowser(value: unknown): unknown {
  const result = projectDiagnostic(value, SDK_BROWSER_PROJECTION_MAX_BYTES);
  return result.kind === "complete"
    ? result.value
    : diagnosticFallback(result, SDK_BROWSER_PROJECTION_MAX_BYTES);
}

/** Produces one redacted SDK Console record within its serialized UTF-8 limit. */
export function safeDiagnosticRecord(
  value: Record<string, unknown>,
  maxBytes = SDK_CONSOLE_DIAGNOSTIC_MAX_BYTES,
): Record<string, unknown> {
  const result = projectDiagnostic(value, maxBytes);
  return result.kind === "complete" &&
      typeof result.value === "object" &&
      result.value !== null &&
      !Array.isArray(result.value)
    ? result.value as Record<string, unknown>
    : diagnosticFallback(
        result.kind === "complete"
          ? { kind: "unsupported", redactionApplied: result.redactionApplied }
          : result,
        maxBytes,
      );
}

/** Produces one redacted runtime error within its serialized UTF-8 limit. */
export function safeDiagnosticError(
  value: WireError,
  maxBytes = SDK_CONSOLE_DIAGNOSTIC_MAX_BYTES,
): WireError {
  const result = projectDiagnostic(value, maxBytes);
  if (result.kind === "complete") return result.value as WireError;
  return {
    code: "RUNTIME_DIAGNOSTIC_TRUNCATED",
    message: "Runtime diagnostic exceeded the SDK Console entry limit.",
    retryable: false,
    details: {
      __qoderDiagnostic: diagnosticMetadata(
        result.kind,
        maxBytes,
        result.redactionApplied,
      ),
    },
  };
}

export function safeRawPayload(
  value: unknown,
  maxBytes = 64 * 1024,
): unknown {
  const result = projectDiagnostic(value, maxBytes);
  if (result.kind === "complete") return result.value;
  return {
    truncated: true,
    maxBytes,
    kind: result.kind,
    ...(result.kind === "truncated" ? { originalBytes: maxBytes + 1 } : {}),
    ...(result.redactionApplied ? { redaction: "[REDACTED]" } : {}),
  };
}
