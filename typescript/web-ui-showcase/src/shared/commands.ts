import { z } from "zod";
import {
  commandIdSchema,
  sessionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { inputPrioritySchema, rewindScopeSchema } from "./model.js";
import {
  selectablePermissionModeSchema,
  selectablePermissionModes,
  type SelectablePermissionMode,
} from "./permissions.js";

export {
  selectablePermissionModeSchema,
  selectablePermissionModes,
  type SelectablePermissionMode,
} from "./permissions.js";

export const commandAcceptedSchema = z
  .object({
    commandId: commandIdSchema,
  })
  .strict();
export type CommandAccepted = z.infer<typeof commandAcceptedSchema>;

export const emptyCommandSchema = z.object({}).strict();

export const registerWorkspaceCommandSchema = z
  .object({
    path: z.string().trim().min(1),
  })
  .strict();

export const sendMessageCommandSchema = z
  .object({
    text: z.string().trim().min(1),
    priority: inputPrioritySchema.default("next"),
    shouldQuery: z.boolean().default(true),
  })
  .strict();
export type SendMessageInput = z.input<typeof sendMessageCommandSchema>;
export type SendMessageCommand = z.output<typeof sendMessageCommandSchema>;

export const interactionResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("allow"),
      suggestionIndexes: z.array(z.number().int().nonnegative()).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deny"),
      message: z.string().trim().min(1),
      interrupt: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("answer"),
      answers: z.record(z.string(), z.string()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("elicit"),
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);
export type InteractionResponse = z.infer<typeof interactionResponseSchema>;

export const permissionModeSchema = selectablePermissionModeSchema;

export const createSessionCommandSchema = z
  .object({
    model: z.string().trim().min(1).optional(),
    permissionMode: selectablePermissionModeSchema.optional(),
  })
  .strict();

export const startSessionCommandSchema = z
  .object({
    workspaceId: workspaceIdSchema.optional(),
    text: z.string().trim().min(1),
    model: z.string().trim().min(1).optional(),
    permissionMode: selectablePermissionModeSchema.optional(),
  })
  .strict();
export type StartSessionCommand = z.infer<typeof startSessionCommandSchema>;

export const sessionStartedSchema = z
  .object({
    sessionId: sessionIdSchema,
    workspaceId: workspaceIdSchema,
  })
  .strict();
export type SessionStarted = z.infer<typeof sessionStartedSchema>;

export const setModelCommandSchema = z
  .object({
    model: z.string().trim().min(1).optional(),
  })
  .strict();

export const setPermissionModeCommandSchema = z
  .object({
    permissionMode: selectablePermissionModeSchema,
  })
  .strict();

export const addDirectoriesCommandSchema = z
  .object({
    directories: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const mcpOAuthCallbackCommandSchema = z
  .object({
    callbackUrl: z.string().url().max(8192),
  })
  .strict();

export const backgroundTasksCommandSchema = z
  .object({
    toolUseId: z.string().min(1).optional(),
  })
  .strict();

export const renameSessionCommandSchema = z
  .object({
    title: z.string().trim().min(1),
  })
  .strict();

export const tagSessionCommandSchema = z
  .object({
    tag: z.string().trim().min(1),
  })
  .strict();

export const forkSessionCommandSchema = z
  .object({
    upToMessageId: z.string().uuid().optional(),
    title: z.string().trim().min(1).optional(),
  })
  .strict();

export const generateTitleCommandSchema = z
  .object({
    description: z.string().trim().min(1),
  })
  .strict();

export const checkpointPreviewCommandSchema = z
  .object({
    userMessageId: z.string().uuid(),
    scope: rewindScopeSchema,
  })
  .strict();
export type CheckpointPreviewCommand = z.infer<
  typeof checkpointPreviewCommandSchema
>;

export const checkpointExecuteCommandSchema = z
  .object({
    previewId: z.string().uuid(),
    userMessageId: z.string().uuid(),
    scope: rewindScopeSchema,
  })
  .strict();
export type CheckpointExecuteCommand = z.infer<
  typeof checkpointExecuteCommandSchema
>;
