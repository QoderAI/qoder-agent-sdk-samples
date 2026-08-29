import { describe, expect, it, vi } from "vitest";
import {
  MCP_ELICITATION_SCHEMA_MAX_DEPTH,
  MCP_ELICITATION_SCHEMA_MAX_NODES,
  MCP_ELICITATION_SCHEMA_MAX_WIRE_BYTES,
  MCP_ELICITATION_UNSUPPORTED_REASON,
  parseMcpElicitationSchema,
  snapshotMcpElicitationSchema,
  validateMcpElicitationContent,
} from "../../../src/shared/mcp-elicitation-schema.js";

const supportedSchema = {
  type: "object",
  title: "只读检查",
  description: "配置 MCP 读取项目。",
  required: ["confirmed", "count", "mode"],
  properties: {
    confirmed: { type: "boolean", title: "确认" },
    count: { type: "integer", title: "次数" },
    threshold: { type: "number", title: "阈值" },
    mode: {
      type: "string",
      title: "模式",
      enum: ["focused", "broad"],
    },
    note: { type: "string", description: "可选说明" },
  },
};

describe("MCP elicitation schema", () => {
  it("parses the closed scalar subset and returns sanitized typed content", () => {
    const parsed = parseMcpElicitationSchema(supportedSchema);
    expect(parsed).toMatchObject({
      supported: true,
      title: "只读检查",
      description: "配置 MCP 读取项目。",
      fields: [
        { name: "confirmed", type: "boolean", required: true },
        { name: "count", type: "integer", required: true },
        { name: "threshold", type: "number", required: false },
        {
          name: "mode",
          type: "string",
          required: true,
          enumValues: ["focused", "broad"],
        },
        { name: "note", type: "string", required: false },
      ],
    });
    if (!parsed.supported) throw new Error("Expected supported schema");

    const validation = validateMcpElicitationContent(parsed, {
      confirmed: true,
      count: 2,
      threshold: 0.75,
      mode: "focused",
    });
    expect(validation).toMatchObject({
      valid: true,
      content: {
        confirmed: true,
        count: 2,
        threshold: 0.75,
        mode: "focused",
      },
    });
    if (!validation.valid) throw new Error("Expected valid content");
    expect(Object.getPrototypeOf(validation.content)).toBeNull();
  });

  it.each([
    ["root oneOf", { ...supportedSchema, oneOf: [] }],
    ["field pattern", {
      type: "object",
      properties: { value: { type: "string", pattern: ".*" } },
    }],
    ["field minimum", {
      type: "object",
      properties: { value: { type: "number", minimum: 0 } },
    }],
    ["field maximum", {
      type: "object",
      properties: { value: { type: "number", maximum: 1 } },
    }],
    ["nested object", {
      type: "object",
      properties: { value: { type: "object", properties: {} } },
    }],
    ["array items", {
      type: "object",
      properties: { value: { type: "array", items: { type: "string" } } },
    }],
  ])("rejects unsupported or behavioral schema keywords: %s", (_label, schema) => {
    expect(parseMcpElicitationSchema(schema)).toMatchObject({
      supported: false,
    });
  });

  it("rejects prototype-related and Object.prototype property names", () => {
    for (const name of [
      ...Object.getOwnPropertyNames(Object.prototype),
      "prototype",
    ]) {
      const properties = Object.create(null) as Record<string, unknown>;
      properties[name] = { type: "string" };
      expect(parseMcpElicitationSchema({
        type: "object",
        properties,
      })).toMatchObject({
        supported: false,
      });
    }
  });

  it("rejects non-enumerable unsupported schema keywords", () => {
    const field = { type: "string" } as Record<string, unknown>;
    Object.defineProperty(field, "pattern", {
      configurable: true,
      value: ".*",
    });

    expect(parseMcpElicitationSchema({
      type: "object",
      properties: { value: field },
    })).toMatchObject({
      supported: false,
      reason: expect.stringContaining("pattern"),
    });
  });

  it("does not discard non-enumerable property definitions", () => {
    const properties = {} as Record<string, unknown>;
    Object.defineProperty(properties, "hidden", {
      configurable: true,
      value: { type: "boolean", title: "隐藏确认" },
    });
    const schema = {
      type: "object",
      properties,
    } as Record<string, unknown>;
    Object.defineProperty(schema, "required", {
      configurable: true,
      value: ["hidden"],
    });
    const parsed = parseMcpElicitationSchema(schema);

    expect(parsed).toMatchObject({
      supported: true,
      fields: [{ name: "hidden", type: "boolean", required: true }],
    });
    if (!parsed.supported) throw new Error("Expected supported schema");
    expect(validateMcpElicitationContent(parsed, {})).toMatchObject({
      valid: false,
      reason: expect.stringContaining("隐藏确认"),
    });
  });

  it("canonicalizes hidden schema fields into one browser-safe semantic snapshot", () => {
    const properties = {} as Record<string, unknown>;
    Object.defineProperty(properties, "confirmed", {
      configurable: true,
      value: { type: "boolean", title: "隐藏确认" },
    });
    const schema = {
      type: "object",
      properties,
    } as Record<string, unknown>;
    Object.defineProperty(schema, "required", {
      configurable: true,
      value: ["confirmed"],
    });

    const snapshot = snapshotMcpElicitationSchema(schema);
    const browserParsed = parseMcpElicitationSchema(
      JSON.parse(JSON.stringify(snapshot.schema)) as unknown,
    );

    expect(snapshot.parsed).toEqual(browserParsed);
    expect(browserParsed).toMatchObject({
      supported: true,
      fields: [{ name: "confirmed", required: true }],
    });
    const browserSchema = snapshot.schema as Record<string, unknown>;
    expect(Object.keys(browserSchema)).toEqual([
      "type",
      "properties",
      "required",
    ]);
    expect(Object.keys(browserSchema.properties as object)).toEqual([
      "confirmed",
    ]);
    expect(Object.getPrototypeOf(browserSchema)).toBeNull();
  });

  it("canonicalizes unsupported hidden keywords without changing browser support", () => {
    const field = { type: "string" } as Record<string, unknown>;
    Object.defineProperty(field, "pattern", {
      configurable: true,
      value: "^safe$",
    });

    const snapshot = snapshotMcpElicitationSchema({
      type: "object",
      properties: { value: field },
    });

    expect(snapshot.parsed).toEqual(
      parseMcpElicitationSchema(
        JSON.parse(JSON.stringify(snapshot.schema)) as unknown,
      ),
    );
    expect(snapshot.parsed).toMatchObject({
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    });
  });

  it("fails unsafe schema snapshots closed without evaluating accessors", () => {
    let getterCalls = 0;
    const accessorSchema = {
      type: "object",
      properties: {},
    } as Record<string, unknown>;
    Object.defineProperty(accessorSchema, "title", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "不应读取";
      },
    });
    const symbolSchema = {
      type: "object",
      properties: {},
      [Symbol("unsupported")]: true,
    };

    for (const schema of [accessorSchema, symbolSchema]) {
      const snapshot = snapshotMcpElicitationSchema(schema);
      expect(snapshot.parsed).toEqual(
        parseMcpElicitationSchema(
          JSON.parse(JSON.stringify(snapshot.schema)) as unknown,
        ),
      );
      expect(snapshot.parsed).toMatchObject({ supported: false });
    }
    expect(getterCalls).toBe(0);
  });

  it("publishes one fixed unsupported schema without source values or forged reasons", () => {
    const source = {
      type: "object",
      title: "SECRET_MARKER",
      properties: {
        password: {
          type: "string",
          default: { apiKey: "NESTED_SECRET" },
        },
      },
      __qoderMcpElicitationSchemaUnsupported: "FORGED_REASON",
    };

    const snapshot = snapshotMcpElicitationSchema(source);
    const wire = JSON.stringify(snapshot.schema);

    expect(snapshot.parsed).toEqual({
      supported: false,
      reason: "MCP 表单 schema 不受支持。",
    });
    expect(wire).toBe(
      '{"__qoderMcpElicitationSchemaUnsupported":true}',
    );
    expect(wire).not.toContain("SECRET_MARKER");
    expect(wire).not.toContain("NESTED_SECRET");
    expect(wire).not.toContain("FORGED_REASON");
  });

  it("enforces explicit depth, node, and wire-byte budgets without throwing", () => {
    expect(MCP_ELICITATION_SCHEMA_MAX_DEPTH).toBe(32);
    expect(MCP_ELICITATION_SCHEMA_MAX_NODES).toBe(1_024);
    expect(MCP_ELICITATION_SCHEMA_MAX_WIRE_BYTES).toBe(64 * 1_024);

    let deep: unknown = { type: "string" };
    for (let depth = 0; depth < 5_000; depth += 1) {
      deep = { nested: deep };
    }
    expect(() => snapshotMcpElicitationSchema(deep)).not.toThrow();
    expect(snapshotMcpElicitationSchema(deep).parsed).toEqual({
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    });

    const properties = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < 520; index += 1) {
      properties[`f${index}`] = { type: "string" };
    }
    const tooManyNodes = snapshotMcpElicitationSchema({
      type: "object",
      properties,
    });
    expect(tooManyNodes.parsed).toEqual({
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    });

    const tooManyBytes = snapshotMcpElicitationSchema({
      type: "object",
      title: "x".repeat(64 * 1_024),
      properties: {},
    });
    expect(tooManyBytes.parsed).toEqual({
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    });
    expect(JSON.stringify(tooManyBytes.schema).length).toBeLessThan(128);
  });

  it("rejects oversized strings and keys before full serialization or encoding", () => {
    const stringify = vi.spyOn(JSON, "stringify");
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    const longKey = "键".repeat(40_000);
    const wideProperties = Object.create(null) as Record<string, unknown>;
    for (let index = 0; index < 300; index += 1) {
      wideProperties[`field-${index}`] = {
        type: "string",
        title: "多字节".repeat(80),
      };
    }

    const snapshots = [
      snapshotMcpElicitationSchema({
        type: "object",
        title: "x".repeat(2 * 1_024 * 1_024),
        properties: {},
      }),
      snapshotMcpElicitationSchema({
        type: "object",
        properties: {
          [longKey]: { type: "string" },
        },
      }),
      snapshotMcpElicitationSchema({
        type: "object",
        title: "你".repeat(30_000),
        properties: {},
      }),
      snapshotMcpElicitationSchema({
        type: "object",
        properties: wideProperties,
      }),
    ];
    const stringifyCalls = stringify.mock.calls.length;
    const encodeCalls = encode.mock.calls.length;
    stringify.mockRestore();
    encode.mockRestore();

    expect(snapshots).toHaveLength(4);
    for (const snapshot of snapshots) {
      expect(snapshot.parsed).toEqual({
        supported: false,
        reason: MCP_ELICITATION_UNSUPPORTED_REASON,
      });
    }
    expect(stringifyCalls).toBe(0);
    expect(encodeCalls).toBe(0);
  });

  it("turns serialization exceptions into the fixed unsupported snapshot", () => {
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("SERIALIZE_SECRET");
    });
    let snapshot: ReturnType<typeof snapshotMcpElicitationSchema> | undefined;

    try {
      expect(() => {
        snapshot = snapshotMcpElicitationSchema({
          type: "object",
          properties: {},
        });
      }).not.toThrow();
    } finally {
      stringify.mockRestore();
    }

    expect(snapshot?.parsed).toEqual({
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    });
  });

  it("rejects non-enumerable response extras", () => {
    const parsed = parseMcpElicitationSchema(supportedSchema);
    if (!parsed.supported) throw new Error("Expected supported schema");
    const content = {
      confirmed: true,
      count: 2,
      mode: "focused",
    } as Record<string, unknown>;
    Object.defineProperty(content, "hidden", {
      configurable: true,
      value: true,
    });

    expect(validateMcpElicitationContent(parsed, content)).toMatchObject({
      valid: false,
      reason: expect.stringContaining("hidden"),
    });
  });

  it("fails closed for accessor and symbol keys", () => {
    const accessorSchema = { type: "object", properties: {} } as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessorSchema, "title", {
      get: () => "不能求值",
    });
    expect(parseMcpElicitationSchema(accessorSchema)).toMatchObject({
      supported: false,
    });

    const symbolSchema = { type: "object", properties: {} } as Record<
      string | symbol,
      unknown
    >;
    symbolSchema[Symbol("hidden")] = true;
    expect(parseMcpElicitationSchema(symbolSchema)).toMatchObject({
      supported: false,
    });

    const parsed = parseMcpElicitationSchema(supportedSchema);
    if (!parsed.supported) throw new Error("Expected supported schema");
    const accessorContent = {
      confirmed: true,
      count: 2,
      mode: "focused",
    } as Record<string, unknown>;
    Object.defineProperty(accessorContent, "hidden", {
      get: () => true,
    });
    expect(validateMcpElicitationContent(parsed, accessorContent)).toMatchObject({
      valid: false,
    });
    const symbolContent = {
      confirmed: true,
      count: 2,
      mode: "focused",
      [Symbol("hidden")]: true,
    };
    expect(validateMcpElicitationContent(parsed, symbolContent)).toMatchObject({
      valid: false,
    });
  });

  it.each([
    ["wrong boolean", {
      confirmed: "true",
      count: 2,
      mode: "focused",
    }],
    ["missing required", { count: 2, mode: "focused" }],
    ["noninteger", { confirmed: true, count: 1.5, mode: "focused" }],
    ["enum mismatch", { confirmed: true, count: 2, mode: "wide" }],
    ["extra key", {
      confirmed: true,
      count: 2,
      mode: "focused",
      extra: true,
    }],
  ])("rejects invalid response content: %s", (_label, content) => {
    const parsed = parseMcpElicitationSchema(supportedSchema);
    if (!parsed.supported) throw new Error("Expected supported schema");
    expect(validateMcpElicitationContent(parsed, content)).toMatchObject({
      valid: false,
    });
  });
});
