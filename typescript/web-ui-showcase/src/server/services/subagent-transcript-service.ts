import type { SubagentTranscriptResponse } from "../../shared/subagents.js";
import { projectHistory } from "../sdk/history-projector.js";
import type { SessionCatalog } from "./session-catalog-port.js";

export class SubagentTranscriptService {
  readonly #catalog: SessionCatalog;

  constructor(options: { catalog: SessionCatalog }) {
    this.#catalog = options.catalog;
  }

  async resolve(
    cwd: string,
    sessionId: string,
    parentToolUseId: string,
  ): Promise<SubagentTranscriptResponse> {
    const agentIds = await this.#catalog.listSubagents(cwd, sessionId);
    for (const agentId of agentIds) {
      const messages = await this.#catalog.subagentMessages(
        cwd,
        sessionId,
        agentId,
      );
      if (!messages.some(
        (message) => message.parentToolUseId === parentToolUseId,
      )) {
        continue;
      }
      const matchingMessages = messages.filter(
        (message) => message.parentToolUseId === parentToolUseId,
      );
      return {
        status: "ready",
        agentId,
        parentToolUseId,
        items: projectHistory(matchingMessages, { includeChildMessages: true }),
      };
    }
    return { status: "waiting" };
  }
}
