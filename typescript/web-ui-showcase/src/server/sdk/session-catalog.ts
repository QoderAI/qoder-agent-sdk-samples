import type {
  SDKSessionInfo,
  SessionMessage,
} from "@qoder-ai/qoder-agent-sdk";
import type {
  HistoricalMessage,
  SessionCatalog,
  SessionRecord,
} from "../services/session-catalog-port.js";
import {
  sdkSessionFunctions,
  type SdkSessionFunctions,
} from "./sdk-public-contract.js";

export type { SdkSessionFunctions } from "./sdk-public-contract.js";

function mapSession(info: SDKSessionInfo, fallbackCwd: string): SessionRecord {
  return {
    id: info.sessionId,
    cwd: info.cwd ?? fallbackCwd,
    title: info.customTitle ?? info.summary,
    updatedAt: new Date(info.lastModified).toISOString(),
    ...(info.createdAt === undefined
      ? {}
      : { createdAt: new Date(info.createdAt).toISOString() }),
    ...(info.tag === undefined ? {} : { tag: info.tag }),
    ...(info.gitBranch === undefined ? {} : { gitBranch: info.gitBranch }),
  };
}

function mapMessage(message: SessionMessage): HistoricalMessage {
  return {
    type: message.type,
    id: message.uuid,
    sessionId: message.session_id,
    message: message.message,
    parentToolUseId: message.parent_tool_use_id,
    ...(message.timestamp === undefined
      ? {}
      : { timestamp: message.timestamp }),
    ...(message.subtype === undefined ? {} : { subtype: message.subtype }),
    ...(message.compact_metadata === undefined
      ? {}
      : { compactMetadata: message.compact_metadata }),
  };
}

export function createSessionCatalog(
  functions: SdkSessionFunctions = sdkSessionFunctions,
): SessionCatalog {
  return {
    async listForWorkspace(cwd) {
      return (await functions.listSessions({ dir: cwd })).map((session) =>
        mapSession(session, cwd),
      );
    },
    async get(cwd, sessionId) {
      const session = await functions.getSessionInfo(sessionId, { dir: cwd });
      return session === undefined ? undefined : mapSession(session, cwd);
    },
    async messages(cwd, sessionId) {
      return (
        await functions.getSessionMessages(sessionId, {
          dir: cwd,
          includeSystemMessages: true,
        })
      ).map(mapMessage);
    },
    rename: (cwd, sessionId, title) =>
      functions.renameSession(sessionId, title, { dir: cwd }),
    tag: (cwd, sessionId, tag) =>
      functions.tagSession(sessionId, tag, { dir: cwd }),
    fork: (cwd, sessionId, input) =>
      functions.forkSession(sessionId, {
        dir: cwd,
        ...(input.upToMessageId === undefined
          ? {}
          : { upToMessageId: input.upToMessageId }),
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
    delete: (cwd, sessionId) =>
      functions.deleteSession(sessionId, { dir: cwd }),
    listSubagents: (cwd, sessionId) =>
      functions.listSubagents(sessionId, { dir: cwd }),
    async subagentMessages(cwd, sessionId, agentId) {
      return (
        await functions.getSubagentMessages(sessionId, agentId, { dir: cwd })
      ).map(mapMessage);
    },
  };
}
