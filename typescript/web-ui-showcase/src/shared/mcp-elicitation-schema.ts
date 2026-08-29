export type McpElicitationScalarType =
  | "string"
  | "number"
  | "integer"
  | "boolean";

export type McpElicitationScalar = string | number | boolean;

export type McpElicitationField = {
  name: string;
  label: string;
  description?: string;
  type: McpElicitationScalarType;
  required: boolean;
  enumValues?: McpElicitationScalar[];
};

export type ParsedMcpElicitationSchema =
  | {
      supported: true;
      title?: string;
      description?: string;
      fields: McpElicitationField[];
    }
  | { supported: false; reason: string };

export type SupportedMcpElicitationSchema = Extract<
  ParsedMcpElicitationSchema,
  { supported: true }
>;

export type McpElicitationContentValidation =
  | {
      valid: true;
      content: Record<string, McpElicitationScalar>;
    }
  | { valid: false; reason: string };

export type McpElicitationSchemaSnapshot = {
  schema: unknown;
  parsed: ParsedMcpElicitationSchema;
};

export const MCP_ELICITATION_SCHEMA_MAX_DEPTH = 32;
export const MCP_ELICITATION_SCHEMA_MAX_NODES = 1_024;
export const MCP_ELICITATION_SCHEMA_MAX_WIRE_BYTES = 64 * 1_024;
export const MCP_ELICITATION_UNSUPPORTED_REASON =
  "MCP 表单 schema 不受支持。";

const scalarTypes = new Set<McpElicitationScalarType>([
  "string",
  "number",
  "integer",
  "boolean",
]);
const rootKeys = new Set([
  "type",
  "properties",
  "required",
  "title",
  "description",
]);
const fieldKeys = new Set(["type", "enum", "title", "description"]);
const unsafePropertyNames = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
]);
const unsupportedSnapshotKey = "__qoderMcpElicitationSchemaUnsupported";

type CanonicalDataResult =
  | { safe: true; value: unknown }
  | { safe: false };

type CanonicalDataBudget = {
  nodes: number;
  wireBytes: number;
};

function unsafeSnapshot(): CanonicalDataResult {
  return { safe: false };
}

function consumeWireBytes(
  budget: CanonicalDataBudget,
  bytes: number,
): boolean {
  if (bytes > MCP_ELICITATION_SCHEMA_MAX_WIRE_BYTES - budget.wireBytes) {
    return false;
  }
  budget.wireBytes += bytes;
  return true;
}

function consumeJsonString(
  value: string,
  budget: CanonicalDataBudget,
): boolean {
  if (!consumeWireBytes(budget, 2)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    let bytes: number;
    if (code === 0x22 || code === 0x5c) {
      bytes = 2;
    } else if (
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
    if (!consumeWireBytes(budget, bytes)) return false;
  }
  return true;
}

function canonicalData(
  value: unknown,
  ancestors: WeakSet<object>,
  budget: CanonicalDataBudget,
  depth: number,
): CanonicalDataResult {
  if (
    depth > MCP_ELICITATION_SCHEMA_MAX_DEPTH ||
    budget.nodes >= MCP_ELICITATION_SCHEMA_MAX_NODES
  ) {
    return unsafeSnapshot();
  }
  budget.nodes += 1;
  if (value === null) {
    return consumeWireBytes(budget, 4)
      ? { safe: true, value }
      : unsafeSnapshot();
  }
  if (typeof value === "string") {
    return consumeJsonString(value, budget)
      ? { safe: true, value }
      : unsafeSnapshot();
  }
  if (typeof value === "boolean") {
    return consumeWireBytes(budget, value ? 4 : 5)
      ? { safe: true, value }
      : unsafeSnapshot();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return unsafeSnapshot();
    const normalized = Object.is(value, -0) ? 0 : value;
    return consumeWireBytes(budget, String(normalized).length)
      ? { safe: true, value: normalized }
      : unsafeSnapshot();
  }
  if (typeof value !== "object") {
    return unsafeSnapshot();
  }
  if (ancestors.has(value)) {
    return unsafeSnapshot();
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (
        keys.some((key) => typeof key !== "string") ||
        lengthDescriptor === undefined ||
        !("value" in lengthDescriptor) ||
        typeof lengthDescriptor.value !== "number"
      ) {
        return unsafeSnapshot();
      }
      const length = lengthDescriptor.value;
      if (
        keys.length !== length + 1 ||
        length > MCP_ELICITATION_SCHEMA_MAX_NODES - budget.nodes ||
        !consumeWireBytes(budget, 2 + Math.max(0, length - 1))
      ) {
        return unsafeSnapshot();
      }
      const snapshot: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (descriptor === undefined || !("value" in descriptor)) {
          return unsafeSnapshot();
        }
        const entry = canonicalData(
          descriptor.value,
          ancestors,
          budget,
          depth + 1,
        );
        if (!entry.safe) return entry;
        snapshot.push(entry.value);
      }
      Object.setPrototypeOf(snapshot, null);
      return { safe: true, value: snapshot };
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return unsafeSnapshot();
    }
    const snapshot = Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(value);
    if (keys.length > MCP_ELICITATION_SCHEMA_MAX_NODES - budget.nodes) {
      return unsafeSnapshot();
    }
    if (!consumeWireBytes(budget, 2)) return unsafeSnapshot();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") {
        return unsafeSnapshot();
      }
      if (
        (index > 0 && !consumeWireBytes(budget, 1)) ||
        !consumeJsonString(key, budget) ||
        !consumeWireBytes(budget, 1)
      ) {
        return unsafeSnapshot();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) {
        return unsafeSnapshot();
      }
      const entry = canonicalData(
        descriptor.value,
        ancestors,
        budget,
        depth + 1,
      );
      if (!entry.safe) return entry;
      snapshot[key] = entry.value;
    }
    return { safe: true, value: snapshot };
  } finally {
    ancestors.delete(value);
  }
}

function unsupportedSchema(): Record<string, unknown> {
  const schema = Object.create(null) as Record<string, unknown>;
  schema[unsupportedSnapshotKey] = true;
  return schema;
}

function unsupportedSchemaSnapshot(): McpElicitationSchemaSnapshot {
  return {
    schema: unsupportedSchema(),
    parsed: {
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    },
  };
}

function ownDataPropertyNames(value: object): string[] | null {
  const names: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return null;
    names.push(key);
  }
  return names;
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const names = ownDataPropertyNames(value);
  if (names === null) return null;
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined || !("value" in descriptor)) return null;
    snapshot[name] = descriptor.value as unknown;
  }
  return snapshot;
}

function dataArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const names = ownDataPropertyNames(value);
  if (names === null) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number"
  ) {
    return null;
  }
  const length = lengthDescriptor.value;
  if (names.length !== length + 1) return null;
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return null;
    snapshot.push(descriptor.value as unknown);
  }
  return snapshot;
}

function recordNames(record: Record<string, unknown>): string[] {
  return Reflect.ownKeys(record) as string[];
}

function ownValue(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function firstUnknownKey(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string | undefined {
  return recordNames(record).find((key) => !allowed.has(key));
}

function optionalText(
  record: Record<string, unknown>,
  key: "title" | "description",
): string | undefined | null {
  const value = ownValue(record, key);
  return value === undefined ? undefined : typeof value === "string" ? value : null;
}

function isScalarType(value: unknown): value is McpElicitationScalarType {
  return typeof value === "string" &&
    scalarTypes.has(value as McpElicitationScalarType);
}

function matchesType(
  value: unknown,
  type: McpElicitationScalarType,
): value is McpElicitationScalar {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
  }
}

/** Parses the complete JSON Schema subset supported by MCP form elicitation. */
export function parseMcpElicitationSchema(
  schema: unknown,
): ParsedMcpElicitationSchema {
  const root = dataRecord(schema);
  if (root === null) {
    return { supported: false, reason: "MCP 表单 schema 必须是 object。" };
  }
  const snapshotFailure = ownValue(root, unsupportedSnapshotKey);
  if (
    snapshotFailure === true &&
    recordNames(root).length === 1
  ) {
    return {
      supported: false,
      reason: MCP_ELICITATION_UNSUPPORTED_REASON,
    };
  }
  if (ownValue(root, "type") !== "object") {
    return { supported: false, reason: "MCP 表单 schema 必须是 object。" };
  }
  const unknownRootKey = firstUnknownKey(root, rootKeys);
  if (unknownRootKey !== undefined) {
    return {
      supported: false,
      reason: `MCP 表单使用了暂不支持的 schema 关键字 ${unknownRootKey}。`,
    };
  }
  const title = optionalText(root, "title");
  const description = optionalText(root, "description");
  if (title === null || description === null) {
    return {
      supported: false,
      reason: "MCP 表单 title 和 description 必须是字符串。",
    };
  }
  const rawProperties = ownValue(root, "properties");
  const properties = rawProperties === undefined
    ? Object.create(null) as Record<string, unknown>
    : dataRecord(rawProperties);
  if (properties === null) {
    return {
      supported: false,
      reason: "MCP 表单 properties 必须是字段对象。",
    };
  }
  const rawRequired = ownValue(root, "required");
  const required = rawRequired === undefined ? [] : dataArray(rawRequired);
  if (required === null || required.some((name) => typeof name !== "string")) {
    return {
      supported: false,
      reason: "MCP 表单 required 必须是字段名称数组。",
    };
  }
  const requiredNames = new Set(required as string[]);
  for (const name of requiredNames) {
    if (
      unsafePropertyNames.has(name) ||
      !Object.prototype.hasOwnProperty.call(properties, name)
    ) {
      return {
        supported: false,
        reason: `必填字段 ${name} 未在 properties 中安全定义。`,
      };
    }
  }

  const fields: McpElicitationField[] = [];
  for (const name of recordNames(properties)) {
    const rawField = ownValue(properties, name);
    if (name.length === 0 || unsafePropertyNames.has(name)) {
      return {
        supported: false,
        reason: `字段名称 ${name || "（空）"} 不受支持。`,
      };
    }
    const field = dataRecord(rawField);
    const rawType = field === null ? undefined : ownValue(field, "type");
    if (field === null || !isScalarType(rawType)) {
      return {
        supported: false,
        reason: `字段 ${name} 使用了暂不支持的 ${String(rawType ?? "未知")} 类型。`,
      };
    }
    const rawTitle = optionalText(field, "title");
    const fieldDescription = optionalText(field, "description");
    if (rawTitle === null || fieldDescription === null) {
      return {
        supported: false,
        reason: `字段 ${name} 的 title 和 description 必须是字符串。`,
      };
    }
    const label = rawTitle !== undefined && rawTitle.trim().length > 0
      ? rawTitle.trim()
      : name;
    const unknownFieldKey = firstUnknownKey(field, fieldKeys);
    if (unknownFieldKey !== undefined) {
      return {
        supported: false,
        reason: `字段 ${label} 使用了暂不支持的 schema 关键字 ${unknownFieldKey}。`,
      };
    }
    const rawEnum = ownValue(field, "enum");
    let enumValues: McpElicitationScalar[] | undefined;
    if (rawEnum !== undefined) {
      const enumEntries = dataArray(rawEnum);
      if (
        enumEntries === null ||
        enumEntries.length === 0 ||
        enumEntries.some((value) => !matchesType(value, rawType))
      ) {
        return {
          supported: false,
          reason: `字段 ${label} 的 enum 与 ${rawType} 类型不匹配。`,
        };
      }
      enumValues = enumEntries as McpElicitationScalar[];
    }
    fields.push({
      name,
      label,
      type: rawType,
      required: requiredNames.has(name),
      ...(fieldDescription === undefined ||
      fieldDescription.trim().length === 0
        ? {}
        : { description: fieldDescription.trim() }),
      ...(enumValues === undefined ? {} : { enumValues }),
    });
  }
  return {
    supported: true,
    fields,
    ...(title === undefined || title.trim().length === 0
      ? {}
      : { title: title.trim() }),
    ...(description === undefined || description.trim().length === 0
      ? {}
      : { description: description.trim() }),
  };
}

/** Creates the one descriptor-safe schema representation used by server and browser. */
export function snapshotMcpElicitationSchema(
  schema: unknown,
): McpElicitationSchemaSnapshot {
  try {
    const canonical = canonicalData(
      schema,
      new WeakSet(),
      { nodes: 0, wireBytes: 0 },
      0,
    );
    if (!canonical.safe) return unsupportedSchemaSnapshot();
    const parsed = parseMcpElicitationSchema(canonical.value);
    if (!parsed.supported) return unsupportedSchemaSnapshot();
    if (typeof JSON.stringify(canonical.value) !== "string") {
      return unsupportedSchemaSnapshot();
    }
    return {
      schema: canonical.value,
      parsed,
    };
  } catch {
    return unsupportedSchemaSnapshot();
  }
}

/** Validates and sanitizes one response against an already parsed form schema. */
export function validateMcpElicitationContent(
  parsed: SupportedMcpElicitationSchema,
  content: unknown,
): McpElicitationContentValidation {
  const record = dataRecord(content);
  if (record === null) {
    return { valid: false, reason: "MCP 表单响应必须是字段对象。" };
  }
  const fields = new Map(parsed.fields.map((field) => [field.name, field]));
  for (const name of recordNames(record)) {
    if (unsafePropertyNames.has(name) || !fields.has(name)) {
      return { valid: false, reason: `MCP 表单响应包含未知字段 ${name}。` };
    }
  }
  const sanitized = Object.create(null) as Record<
    string,
    McpElicitationScalar
  >;
  const missing = parsed.fields.filter(
    (field) =>
      field.required &&
      !Object.prototype.hasOwnProperty.call(record, field.name),
  );
  if (missing.length > 0) {
    return {
      valid: false,
      reason: `请填写：${missing.map((field) => field.label).join("、")}`,
    };
  }
  for (const field of parsed.fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field.name)) {
      continue;
    }
    const value = ownValue(record, field.name);
    if (!matchesType(value, field.type)) {
      return {
        valid: false,
        reason:
          field.type === "integer"
            ? `${field.label}必须是整数。`
            : field.type === "number"
              ? `${field.label}必须是数字。`
              : field.type === "boolean"
                ? `${field.label}必须选择是或否。`
                : `${field.label}必须是文本。`,
      };
    }
    if (
      field.enumValues !== undefined &&
      !field.enumValues.some((candidate) => Object.is(candidate, value))
    ) {
      return { valid: false, reason: `${field.label}必须使用列表中的值。` };
    }
    sanitized[field.name] = value;
  }
  return { valid: true, content: sanitized };
}
