import { describe, expect, it } from "vitest";
import {
  redactForBrowser,
  safeRawPayload,
} from "../../../../src/server/sdk/redact.js";

describe("browser redaction", () => {
  it("does not execute accessors while projecting diagnostics", () => {
    let reads = 0;
    const value = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(value, "visible", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("GETTER_SECRET");
      },
    });

    const result = redactForBrowser(value);

    expect(reads).toBe(0);
    expect(JSON.stringify(result)).not.toContain("GETTER_SECRET");
    expect(result).toMatchObject({
      __qoderDiagnostic: { kind: "unsupported" },
    });
  });

  it("converts reflection failures into a fixed safe diagnostic", () => {
    const value = new Proxy({}, {
      ownKeys() {
        throw new Error("TRAP_SECRET");
      },
    });

    const result = safeRawPayload(value);

    expect(JSON.stringify(result)).not.toContain("TRAP_SECRET");
    expect(result).toMatchObject({ truncated: true });
  });

  it("bounds deep and oversized diagnostics before full serialization", () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let depth = 0; depth < 5_000; depth += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }

    expect(() => safeRawPayload(root)).not.toThrow();
    expect(safeRawPayload(root)).toMatchObject({ truncated: true });
    expect(
      safeRawPayload({ content: "界".repeat(10_000_000) }, 1024),
    ).toMatchObject({ truncated: true, maxBytes: 1024 });
  });

  it("recursively replaces credential values", () => {
    expect(
      redactForBrowser({
        nested: { access_token: "secret", safe: "visible" },
        authorization: "Bearer secret",
        array: [{ API_KEY: "key" }],
      }),
    ).toEqual({
      nested: { access_token: "[REDACTED]", safe: "visible" },
      authorization: "[REDACTED]",
      array: [{ API_KEY: "[REDACTED]" }],
    });
  });

  it("normalizes credential keys across case and separator styles", () => {
    const secrets = {
      apiKey: "camel-api",
      "API-KEY": "hyphen-api",
      accessToken: "camel-access",
      "Access-Token": "hyphen-access",
      refreshToken: "camel-refresh",
      clientSecret: "camel-client",
      privateKey: "camel-private",
      Authorization: "Bearer mixed-case",
    };

    expect(redactForBrowser(secrets)).toEqual(
      Object.fromEntries(
        Object.keys(secrets).map((key) => [key, "[REDACTED]"]),
      ),
    );
  });

  it("handles cycles without throwing", () => {
    const value: Record<string, unknown> = { visible: true };
    value.self = value;

    expect(redactForBrowser(value)).toEqual({
      visible: true,
      self: "[CIRCULAR]",
    });
  });

  it("returns a bounded redacted preview for oversized payloads", () => {
    const result = safeRawPayload(
      {
        clientSecret: "oversized-camel-secret",
        content: "x".repeat(500),
      },
      80,
    );

    expect(result).toMatchObject({ truncated: true });
    expect(JSON.stringify(result)).not.toContain("oversized-camel-secret");
    expect(JSON.stringify(result)).toContain("[REDACTED]");
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(
      300,
    );
  });
});
