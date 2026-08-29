import { z } from "zod";

/** Permission modes intentionally exposed by the product UI. */
export const selectablePermissionModes = [
  "default",
  "acceptEdits",
  "auto",
] as const;

export const selectablePermissionModeSchema = z.enum(
  selectablePermissionModes,
);
export type SelectablePermissionMode = z.infer<
  typeof selectablePermissionModeSchema
>;
