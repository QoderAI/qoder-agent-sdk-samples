import { z } from "zod";

export const workspaceFileQuerySchema = z
  .object({
    q: z.string().max(200).default(""),
  })
  .strict();

export const workspaceFileItemSchema = z
  .object({
    path: z.string().min(1),
    mention: z.string().min(1),
    rootLabel: z.string().min(1),
    source: z.enum(["workspace", "allowed"]),
  })
  .strict();

export const workspaceFileSearchResultSchema = z
  .object({
    items: z.array(workspaceFileItemSchema),
    truncated: z.boolean(),
  })
  .strict();
export type WorkspaceFileItem = z.infer<typeof workspaceFileItemSchema>;
export type WorkspaceFileSearchResult = z.infer<
  typeof workspaceFileSearchResultSchema
>;
