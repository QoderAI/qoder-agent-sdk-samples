import { z } from "zod";
import { conversationItemSchema } from "./model.js";

export const subagentTranscriptResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("waiting") }).strict(),
  z.object({
    status: z.literal("ready"),
    agentId: z.string().min(1).max(500),
    parentToolUseId: z.string().min(1).max(500),
    items: z.array(conversationItemSchema),
  }).strict(),
]);

export type SubagentTranscriptResponse = z.infer<
  typeof subagentTranscriptResponseSchema
>;
