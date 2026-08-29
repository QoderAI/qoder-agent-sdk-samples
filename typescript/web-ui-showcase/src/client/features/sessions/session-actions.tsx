import type { AcceptedCommand } from "../workspaces/workspace-panel.js";

export type SessionActionApi = {
  renameSession(sessionId: string, title: string): Promise<AcceptedCommand>;
  tagSession(sessionId: string, tag: string): Promise<AcceptedCommand>;
  forkSession(sessionId: string, input: object): Promise<AcceptedCommand>;
  deleteSession(sessionId: string): Promise<AcceptedCommand>;
  generateTitle(sessionId: string, description: string): Promise<AcceptedCommand>;
};
