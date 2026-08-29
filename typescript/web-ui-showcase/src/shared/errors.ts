import { z } from "zod";

export const wireErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type WireError = z.infer<typeof wireErrorSchema>;

export const runtimeCapabilityIdSchema = z.enum([
  "initialization",
  "models",
  "permission",
  "commands",
  "agents",
  "plugins",
  "account",
  "context",
  "credits",
  "mcp",
]);
export type RuntimeCapabilityId = z.infer<typeof runtimeCapabilityIdSchema>;

export const runtimeRefreshErrorDetailsSchema = z
  .object({
    provenance: z.literal("runtime-refresh"),
    capability: runtimeCapabilityIdSchema,
    __qoderDiagnostic: z
      .object({
        kind: z.literal("truncated"),
        originalBytes: z.number().int().positive(),
        maxBytes: z.number().int().positive(),
        redaction: z.literal("[REDACTED]").optional(),
        preview: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Returns the exact capability owned by a runtime refresh diagnostic. */
export function runtimeRefreshCapability(
  error: WireError,
): RuntimeCapabilityId | undefined {
  const parsed = runtimeRefreshErrorDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.capability : undefined;
}
