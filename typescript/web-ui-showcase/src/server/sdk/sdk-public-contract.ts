import {
  deleteSession,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  listSubagents,
  renameSession,
  tagSession,
} from "@qoder-ai/qoder-agent-sdk";

export type SdkSessionFunctions = {
  listSessions: typeof listSessions;
  getSessionInfo: typeof getSessionInfo;
  getSessionMessages: typeof getSessionMessages;
  renameSession: typeof renameSession;
  tagSession: typeof tagSession;
  forkSession: typeof forkSession;
  deleteSession: typeof deleteSession;
  listSubagents: typeof listSubagents;
  getSubagentMessages: typeof getSubagentMessages;
};

export const sdkSessionFunctions = {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  tagSession,
  forkSession,
  deleteSession,
  listSubagents,
  getSubagentMessages,
} satisfies SdkSessionFunctions;
