import { z } from "zod";
import { sessionIdSchema } from "./ids.js";
import {
  conversationItemSchema,
  checkpointPreviewViewSchema,
  sessionRuntimeViewSchema,
  interactionViewSchema,
  mcpServerViewSchema,
  queuedInputViewSchema,
  sessionViewSchema,
  taskViewSchema,
  workspaceViewSchema,
} from "./model.js";

export const appSnapshotSchema = z
  .object({
    serverEpoch: z.string().min(1),
    cursor: z.number().int().nonnegative(),
    workspaces: z.array(workspaceViewSchema),
    sessions: z.array(sessionViewSchema),
    messages: z.record(sessionIdSchema, z.array(conversationItemSchema)),
    queuedInputs: z.array(queuedInputViewSchema),
    interactions: z.array(interactionViewSchema),
    tasks: z.array(taskViewSchema),
    mcpServers: z.array(mcpServerViewSchema),
    checkpointPreviews: z.array(checkpointPreviewViewSchema),
    runtime: z.record(sessionIdSchema, sessionRuntimeViewSchema),
  })
  .strict();

export type AppSnapshot = z.infer<typeof appSnapshotSchema>;
