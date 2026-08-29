/** Current object shown in the contextual details panel. */
export type DetailsSelection =
  | { kind: "task"; sessionId: string; taskId: string }
  | { kind: "approval"; sessionId: string; interactionId: string }
  | { kind: "subagent"; sessionId: string; toolUseId: string }
  | null;
