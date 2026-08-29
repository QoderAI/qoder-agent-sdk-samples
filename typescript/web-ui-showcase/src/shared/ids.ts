import { z } from "zod";

export const workspaceIdSchema = z.string().uuid();
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;

export const sessionIdSchema = z.string().uuid();
export type SessionId = z.infer<typeof sessionIdSchema>;

export const interactionIdSchema = z.string().uuid();
export type InteractionId = z.infer<typeof interactionIdSchema>;

export const commandIdSchema = z.string().uuid();
export type CommandId = z.infer<typeof commandIdSchema>;

export const messageIdSchema = z.string().uuid();
export type MessageId = z.infer<typeof messageIdSchema>;
