import { isSensitiveDiagnosticKey } from "./redact.js";

const SENSITIVE_INSPECTION_LIMIT = 4_096;
const SENSITIVE_NORMALIZATION_PASSES = 4;
const credentialHeader = /(^|[^\p{L}\p{N}_-])(["']?)([a-z0-9_-]*(?:authorization|cookie))\2(\s*\]?\s*[:=]\s*)[^\r\n]*/gimu;
const credentialAssignment = /(^|[^\p{L}\p{N}_-])(["']?)([a-z0-9_-]*(?:credentials?|password|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?key|service[_-]?account[_-]?key|client[_-]?secret|private[_-]?key))\2(\s*\]?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^&;,}\]\r\n]*)/gimu;
const quotedCredentialAssignment = /(^|[^\p{L}\p{N}_-])(["'])([^"'\\\r\n]+)\2(\s*\]?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^&;,}\]\r\n]*)/gimu;
const bearerCredential = /\bbearer\s+[^\s,;]+/giu;
const diagnosticToken = /[\p{L}\p{N}_$.[\]'"-]+/gu;
const stackPosition = /^(.*):\d+:\d+$/u;
const stackProtocol = /^(?:https?|file|resource|webpack-internal|webpack|blob|chrome-extension|moz-extension):\/\//iu;
const stackFileExtension = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|cpp|c|h|html|css|wasm)$/iu;
const bearerReference = /\bbearer\b/iu;
const unresolvedEncoding = /\\(?:[\p{L}\p{N}"'\\/]|[^\S\r\n])|%[\p{L}\p{N}]{1,2}/u;
const nativeStackLocation = /(?:^|[@(])(?:\[native code\]|native(?: code)?)(?:$|[)])/iu;

function redactCredentialText(value: string): string {
  return value
    .replace(
      quotedCredentialAssignment,
      (match, boundary: string, quote: string, key: string, separator: string) =>
        isSensitiveDiagnosticKey(key)
          ? `${boundary}${quote}${key}${quote}${separator}[REDACTED]`
          : match,
    )
    .replace(
      credentialAssignment,
      (match, boundary: string, quote: string, key: string, separator: string) =>
        isSensitiveDiagnosticKey(key)
          ? `${boundary}${quote}${key}${quote}${separator}[REDACTED]`
          : match,
    )
    .replace(
      credentialHeader,
      (_match, boundary: string, quote: string, key: string, separator: string) =>
        `${boundary}${quote}${key}${quote}${separator}[REDACTED]`,
    )
    .replace(bearerCredential, "Bearer [REDACTED]");
}

function decodeInspectionLayer(value: string): string {
  return value
    .replace(/%([0-9a-f]{2})/giu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/giu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-f]{2})/giu, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\(["'\\/bfnrtv]|[^\S\r\n])/gu, (_match, escaped: string) => {
      switch (escaped) {
        case "b":
        case "f":
        case "n":
        case "r":
        case "t":
        case "v":
          return " ";
        default:
          return escaped;
      }
    });
}

function normalizeForSensitiveInspection(value: string): string | undefined {
  let normalized = value.slice(0, SENSITIVE_INSPECTION_LIMIT);
  for (let pass = 0; pass < SENSITIVE_NORMALIZATION_PASSES; pass += 1) {
    const next = decodeInspectionLayer(normalized);
    if (next === normalized) break;
    normalized = next;
  }
  return unresolvedEncoding.test(normalized) ? undefined : normalized;
}

function containsSensitiveDiagnosticReference(value: string): boolean {
  const normalized = normalizeForSensitiveInspection(value);
  if (normalized === undefined || bearerReference.test(normalized)) return true;
  return [...normalized.matchAll(diagnosticToken)].some((match) =>
    isSensitiveDiagnosticKey(match[0])
  );
}

function isStackLocation(value: string): boolean {
  const match = stackPosition.exec(value.trim());
  if (match === null) return false;
  const source = match[1] ?? "";
  return stackProtocol.test(source) ||
    source === "<anonymous>" ||
    source.startsWith("node:") ||
    /^internal[\\/]/iu.test(source) ||
    source.startsWith("/") ||
    /^[a-z]:[\\/]/iu.test(source) ||
    source.includes("/") ||
    source.includes("\\") ||
    stackFileExtension.test(source);
}

function isStackFrame(value: string): boolean {
  const line = value.trim();
  if (line.length === 0) return false;
  if (/^(?:\[native code\]|native(?: code)?)$/iu.test(line)) return true;
  const stackStyle = /^at\s/u.test(line) || line.includes("@");
  if (!stackStyle) return false;
  if (
    nativeStackLocation.test(line) ||
    /^at\s+(?:\[native code\]|native(?: code)?)$/iu.test(line)
  ) return true;
  return line
    .split(/[\s(),]+/u)
    .some((token) => {
      if (isStackLocation(token)) return true;
      const separator = token.lastIndexOf("@");
      return separator >= 0 && isStackLocation(token.slice(separator + 1));
    });
}

/**
 * Cleans an SDK error text for safe browser projection: redacts
 * credential-shaped assignments and bearer tokens, drops stack frames
 * and lines that still reference sensitive keys after URL/escape decoding,
 * then truncates the result to `limit` characters.
 *
 * Extracted from the message projector so that SDK message projection stays
 * focused on `SDKMessage` → `ProjectionAction`. The structured object
 * redactor lives in `redact.ts`; this module handles free-form error text.
 */
export function boundedErrorText(value: string, limit: number): string {
  const normalized = value
    .split(/\r?\n/u)
    .map((line) => redactCredentialText(line))
    .filter((line) =>
      !containsSensitiveDiagnosticReference(line) && !isStackFrame(line)
    )
    .join("\n")
    .trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit - 1)}…`;
}
