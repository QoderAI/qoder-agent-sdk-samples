import { z } from "zod";
import { wireErrorSchema } from "./errors.js";
import {
  commandIdSchema,
  interactionIdSchema,
  sessionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import {
  conversationItemSchema,
  checkpointPreviewViewSchema,
  sessionRuntimeViewSchema,
  interactionViewSchema,
  mcpServerViewSchema,
  queuedInputViewSchema,
  sessionLifecycleSchema,
  sessionViewSchema,
  taskViewSchema,
  workspaceViewSchema,
} from "./model.js";

const timestampSchema = z.string().datetime({ offset: true });

const eventEnvelopeFields = {
  serverEpoch: z.string().min(1),
  sequence: z.number().int().positive(),
  sessionId: sessionIdSchema.optional(),
  commandId: commandIdSchema.optional(),
  occurredAt: timestampSchema,
};

function eventSchema<T extends string, S extends z.ZodType>(
  type: T,
  payload: S,
) {
  return z
    .object({
      type: z.literal(type),
      payload,
    })
    .strict();
}

function envelopeSchema<T extends string, S extends z.ZodType>(
  type: T,
  payload: S,
) {
  return z
    .object({
      ...eventEnvelopeFields,
      type: z.literal(type),
      payload,
    })
    .strict();
}

const workspaceRemovedPayloadSchema = z
  .object({ workspaceId: workspaceIdSchema })
  .strict();
const sessionRemovedPayloadSchema = z
  .object({ sessionId: sessionIdSchema })
  .strict();
const sessionLifecyclePayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    lifecycle: sessionLifecycleSchema,
  })
  .strict();
const conversationItemPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    item: conversationItemSchema,
  })
  .strict();
const conversationReplacedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    items: z.array(conversationItemSchema),
  })
  .strict();
const interactionResolvedPayloadSchema = z
  .object({
    interactionId: interactionIdSchema,
    status: z.enum(["resolved", "cancelled"]),
    resolvedAt: timestampSchema,
    decision: z.string().optional(),
  })
  .strict();
const inputRemovedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    messageUuid: z.string().uuid(),
  })
  .strict();
const taskRemovedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    taskId: z.string().min(1),
  })
  .strict();
const runtimeUpdatedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    runtime: sessionRuntimeViewSchema,
  })
  .strict();
const checkpointCompletedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    previewId: z.string().uuid(),
    status: z.enum(["success", "partial"]),
    failedFiles: z.array(z.string()),
  })
  .strict();
const checkpointRemovedPayloadSchema = z
  .object({
    sessionId: sessionIdSchema,
    previewId: z.string().uuid(),
  })
  .strict();
const commandFailedPayloadSchema = z
  .object({
    error: wireErrorSchema,
  })
  .strict();

export const appEventSchema = z.discriminatedUnion("type", [
  eventSchema("workspace.upserted", workspaceViewSchema),
  eventSchema("workspace.removed", workspaceRemovedPayloadSchema),
  eventSchema("session.upserted", sessionViewSchema),
  eventSchema("session.removed", sessionRemovedPayloadSchema),
  eventSchema("session.lifecycle", sessionLifecyclePayloadSchema),
  eventSchema("conversation.item", conversationItemPayloadSchema),
  eventSchema("conversation.replaced", conversationReplacedPayloadSchema),
  eventSchema("interaction.opened", interactionViewSchema),
  eventSchema("interaction.resolved", interactionResolvedPayloadSchema),
  eventSchema("input.upserted", queuedInputViewSchema),
  eventSchema("input.removed", inputRemovedPayloadSchema),
  eventSchema("task.upserted", taskViewSchema),
  eventSchema("task.removed", taskRemovedPayloadSchema),
  eventSchema("mcp.status", mcpServerViewSchema),
  eventSchema("runtime.updated", runtimeUpdatedPayloadSchema),
  eventSchema("checkpoint.previewed", checkpointPreviewViewSchema),
  eventSchema("checkpoint.removed", checkpointRemovedPayloadSchema),
  eventSchema("checkpoint.completed", checkpointCompletedPayloadSchema),
  eventSchema("command.failed", commandFailedPayloadSchema),
]);
export type AppEvent = z.infer<typeof appEventSchema>;

export const eventEnvelopeSchema = z.discriminatedUnion("type", [
  envelopeSchema("workspace.upserted", workspaceViewSchema),
  envelopeSchema("workspace.removed", workspaceRemovedPayloadSchema),
  envelopeSchema("session.upserted", sessionViewSchema),
  envelopeSchema("session.removed", sessionRemovedPayloadSchema),
  envelopeSchema("session.lifecycle", sessionLifecyclePayloadSchema),
  envelopeSchema("conversation.item", conversationItemPayloadSchema),
  envelopeSchema("conversation.replaced", conversationReplacedPayloadSchema),
  envelopeSchema("interaction.opened", interactionViewSchema),
  envelopeSchema("interaction.resolved", interactionResolvedPayloadSchema),
  envelopeSchema("input.upserted", queuedInputViewSchema),
  envelopeSchema("input.removed", inputRemovedPayloadSchema),
  envelopeSchema("task.upserted", taskViewSchema),
  envelopeSchema("task.removed", taskRemovedPayloadSchema),
  envelopeSchema("mcp.status", mcpServerViewSchema),
  envelopeSchema("runtime.updated", runtimeUpdatedPayloadSchema),
  envelopeSchema("checkpoint.previewed", checkpointPreviewViewSchema),
  envelopeSchema("checkpoint.removed", checkpointRemovedPayloadSchema),
  envelopeSchema("checkpoint.completed", checkpointCompletedPayloadSchema),
  envelopeSchema("command.failed", commandFailedPayloadSchema),
]);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
