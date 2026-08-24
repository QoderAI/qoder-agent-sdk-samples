import { z } from "zod";
import { wireErrorSchema } from "./errors.js";
import {
  interactionIdSchema,
  messageIdSchema,
  sessionIdSchema,
  workspaceIdSchema,
} from "./ids.js";
import { selectablePermissionModeSchema } from "./permissions.js";

const timestampSchema = z.string().datetime({ offset: true });

export const sessionPhaseSchema = z.enum([
  "restorable",
  "starting",
  "idle",
  "running",
  "interrupting",
]);
export type SessionPhase = z.infer<typeof sessionPhaseSchema>;

export const sessionLifecycleSchema = z
  .object({
    phase: sessionPhaseSchema,
    awaitingUser: z.boolean(),
    failure: wireErrorSchema.optional(),
  })
  .strict();
export type SessionLifecycleView = z.infer<typeof sessionLifecycleSchema>;

export const interactionKindSchema = z.enum([
  "tool-approval",
  "question",
  "mcp-elicitation",
]);
export type InteractionKind = z.infer<typeof interactionKindSchema>;

export const inputPrioritySchema = z.enum(["now", "next", "later"]);
export type InputPriority = z.infer<typeof inputPrioritySchema>;

export const workspaceViewSchema = z
  .object({
    id: workspaceIdSchema,
    displayName: z.string().min(1),
    path: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;

export const sessionViewSchema = z
  .object({
    id: sessionIdSchema,
    workspaceId: workspaceIdSchema,
    title: z.string().min(1),
    cwd: z.string().min(1),
    phase: sessionPhaseSchema,
    awaitingUser: z.boolean(),
    updatedAt: timestampSchema,
    createdAt: timestampSchema.optional(),
    tag: z.string().optional(),
    gitBranch: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    failure: wireErrorSchema.optional(),
  })
  .strict();
export type SessionView = z.infer<typeof sessionViewSchema>;

const conversationBase = {
  id: messageIdSchema,
  sessionId: sessionIdSchema,
  createdAt: timestampSchema,
};

const userConversationItemSchema = z
  .object({
    ...conversationBase,
    kind: z.literal("user"),
    text: z.string(),
    messageUuid: z.string().uuid().optional(),
  })
  .strict();

const assistantConversationItemSchema = z
  .object({
    ...conversationBase,
    kind: z.literal("assistant"),
    text: z.string(),
    status: z
      .enum(["streaming", "complete", "interrupted", "failed"])
      .default("complete"),
  })
  .strict();

export const toolLifecycleSchema = z.enum([
  "requested",
  "running",
  "completed",
  "failed",
]);
export type ToolLifecycle = z.infer<typeof toolLifecycleSchema>;

const toolConversationItemSchema = z
  .object({
    ...conversationBase,
    kind: z.literal("tool"),
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    lifecycle: toolLifecycleSchema,
    input: z.unknown(),
    result: z.unknown().optional(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

const progressConversationItemSchema = z
  .object({
    ...conversationBase,
    kind: z.literal("progress"),
    label: z.string().min(1),
    detail: z.string().optional(),
  })
  .strict();

const errorConversationItemSchema = z
  .object({
    ...conversationBase,
    kind: z.literal("error"),
    error: wireErrorSchema,
  })
  .strict();

export const conversationItemSchema = z.discriminatedUnion("kind", [
  userConversationItemSchema,
  assistantConversationItemSchema,
  toolConversationItemSchema,
  progressConversationItemSchema,
  errorConversationItemSchema,
]);
export type ConversationItem = z.infer<typeof conversationItemSchema>;

export const queuedInputViewSchema = z
  .object({
    sessionId: sessionIdSchema,
    uuid: z.string().uuid(),
    priority: inputPrioritySchema,
    shouldQuery: z.boolean(),
    textPreview: z.string().max(160),
    state: z.enum(["buffered", "delivered"]),
  })
  .strict();
export type QueuedInputView = z.infer<typeof queuedInputViewSchema>;

const permissionSuggestionViewSchema = z
  .object({
    index: z.number().int().nonnegative(),
    label: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const questionOptionViewSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

const questionViewSchema = z
  .object({
    header: z.string().min(1),
    question: z.string().min(1),
    options: z.array(questionOptionViewSchema).min(2),
    multiSelect: z.boolean(),
  })
  .strict();

const interactionBase = {
  id: interactionIdSchema,
  sessionId: sessionIdSchema,
  openedAt: timestampSchema,
  status: z.enum(["pending", "resolved", "cancelled"]),
  resolvedAt: timestampSchema.optional(),
  decision: z.string().optional(),
};

const toolApprovalInteractionSchema = z
  .object({
    ...interactionBase,
    kind: z.literal("tool-approval"),
    toolName: z.string().min(1),
    input: z.unknown(),
    permissionSuggestions: z.array(permissionSuggestionViewSchema),
  })
  .strict();

const questionInteractionSchema = z
  .object({
    ...interactionBase,
    kind: z.literal("question"),
    questions: z.array(questionViewSchema).min(1),
  })
  .strict();

const mcpElicitationInteractionSchema = z
  .object({
    ...interactionBase,
    kind: z.literal("mcp-elicitation"),
    serverName: z.string().min(1),
    mode: z.enum(["form", "url"]),
    prompt: z.string().optional(),
    requestedSchema: z.unknown().optional(),
    url: z.string().url().optional(),
    validationError: z.string().optional(),
  })
  .strict();

export const interactionViewSchema = z.discriminatedUnion("kind", [
  toolApprovalInteractionSchema,
  questionInteractionSchema,
  mcpElicitationInteractionSchema,
]);
export type InteractionView = z.infer<typeof interactionViewSchema>;

export const taskViewSchema = z
  .object({
    sessionId: sessionIdSchema,
    taskId: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    foreground: z.boolean(),
    startedAt: timestampSchema.optional(),
    completedAt: timestampSchema.optional(),
    elapsedMs: z.number().nonnegative().optional(),
    progress: z.number().min(0).max(1).optional(),
    toolUseId: z.string().optional(),
    error: wireErrorSchema.optional(),
  })
  .strict();
export type TaskView = z.infer<typeof taskViewSchema>;

export const mcpServerViewSchema = z
  .object({
    sessionId: sessionIdSchema,
    name: z.string().min(1),
    status: z.enum([
      "disconnected",
      "connecting",
      "connected",
      "needs-auth",
      "failed",
    ]),
    authUrl: z.string().url().optional(),
    serverInfo: z.record(z.string(), z.unknown()).optional(),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
    error: wireErrorSchema.optional(),
  })
  .strict();
export type McpServerView = z.infer<typeof mcpServerViewSchema>;

export const rewindScopeSchema = z.enum([
  "files",
  "conversation",
  "both",
]);
export type RewindScopeView = z.infer<typeof rewindScopeSchema>;

export const checkpointPreviewViewSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: sessionIdSchema,
    userMessageId: messageIdSchema,
    scope: rewindScopeSchema,
    expiresAt: timestampSchema,
    canRewind: z.boolean(),
    status: z.enum(["ready", "success", "partial", "rejected"]),
    filesChanged: z.array(z.string()),
    insertions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    failedFiles: z.array(
      z
        .object({ path: z.string(), error: z.string() })
        .strict(),
    ),
    error: wireErrorSchema.optional(),
  })
  .strict();
export type CheckpointPreviewView = z.infer<
  typeof checkpointPreviewViewSchema
>;

export const commandViewSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().default(""),
    argumentHint: z.string().default(""),
  })
  .strict();
export type CommandView = z.infer<typeof commandViewSchema>;

export const composerCommandExecutionSchema = z.enum([
  "sdk-input",
  "model-control",
  "permission-control",
  "mcp-control",
  "context-control",
]);
export type ComposerCommandExecution = z.infer<
  typeof composerCommandExecutionSchema
>;

export const composerCommandViewSchema = commandViewSchema.extend({
  execution: composerCommandExecutionSchema,
});
export type ComposerCommandView = z.infer<typeof composerCommandViewSchema>;

export const sessionRuntimeViewSchema = z
  .object({
    sessionId: sessionIdSchema,
    currentModel: z.string().min(1).nullable(),
    currentPermissionMode: selectablePermissionModeSchema,
    capabilities: z.array(z.string()).default([]),
    context: z.record(z.string(), z.unknown()).optional(),
    contextStatus: z.enum(["loading", "ready", "unsupported"]).optional(),
    credits: z.record(z.string(), z.unknown()).nullable().optional(),
    account: z.record(z.string(), z.unknown()).optional(),
    allowedDirectories: z.array(z.string().min(1)).optional(),
    models: z.array(z.record(z.string(), z.unknown())).optional(),
    commands: z.array(commandViewSchema).optional(),
    composerCommands: z.array(composerCommandViewSchema).optional(),
    agents: z.array(z.record(z.string(), z.unknown())).optional(),
    plugins: z.array(z.record(z.string(), z.unknown())).optional(),
    skills: z.array(z.string()).optional(),
    promptSuggestions: z.array(z.string()).optional(),
    hooks: z.array(z.record(z.string(), z.unknown())).default([]),
    rawEvents: z.array(z.record(z.string(), z.unknown())).default([]),
    versions: z
      .object({
        sdk: z.string().optional(),
        cli: z.string().optional(),
      })
      .strict()
      .optional(),
    errors: z.array(wireErrorSchema).default([]),
  })
  .strict();
export type SessionRuntimeView = z.infer<typeof sessionRuntimeViewSchema>;
