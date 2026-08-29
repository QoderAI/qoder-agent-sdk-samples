export type SessionRecord = {
  id: string;
  cwd: string;
  title: string;
  updatedAt: string;
  createdAt?: string;
  tag?: string;
  gitBranch?: string;
};

export type HistoricalMessage = {
  type: "user" | "assistant" | "system";
  id: string;
  sessionId: string;
  message: unknown;
  parentToolUseId: string | null;
  timestamp?: string;
  subtype?: string;
  compactMetadata?: unknown;
};

export interface SessionCatalog {
  listForWorkspace(cwd: string): Promise<SessionRecord[]>;
  get(cwd: string, sessionId: string): Promise<SessionRecord | undefined>;
  messages(cwd: string, sessionId: string): Promise<HistoricalMessage[]>;
  rename(cwd: string, sessionId: string, title: string): Promise<void>;
  tag(cwd: string, sessionId: string, tag: string): Promise<void>;
  fork(
    cwd: string,
    sessionId: string,
    input: { upToMessageId?: string; title?: string },
  ): Promise<{ sessionId: string }>;
  delete(cwd: string, sessionId: string): Promise<void>;
  listSubagents(cwd: string, sessionId: string): Promise<string[]>;
  subagentMessages(
    cwd: string,
    sessionId: string,
    agentId: string,
  ): Promise<HistoricalMessage[]>;
}
