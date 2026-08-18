import type { InteractionResponse, SendMessageInput } from "../../../shared/commands.js";
import type { WorkspaceFileSearchResult } from "../../../shared/workspace-files.js";
import type { SubagentTranscriptResponse } from "../../../shared/subagents.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { InteractionCard } from "../interactions/interaction-card.js";
import { MessageList } from "./message-list.js";

type Accepted = { commandId: string };

export type ConversationApi = {
  sendMessage(sessionId: string, input: SendMessageInput): Promise<Accepted>;
  cancelMessage(sessionId: string, uuid: string): Promise<Accepted>;
  respondToInteraction(id: string, response: InteractionResponse): Promise<Accepted>;
  stopTask(sessionId: string, taskId: string): Promise<Accepted>;
  backgroundTasks(sessionId: string, toolUseId?: string): Promise<Accepted>;
  interruptSession(sessionId: string): Promise<Accepted>;
  refreshContext(sessionId: string): Promise<Accepted>;
  searchWorkspaceFiles(
    sessionId: string,
    query: string,
  ): Promise<WorkspaceFileSearchResult>;
  getSubagentTranscript(
    sessionId: string,
    toolUseId: string,
    signal?: AbortSignal,
  ): Promise<SubagentTranscriptResponse>;
};

export function ConversationPanel(props: {
  api: ConversationApi;
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const sessionId = state.selectedSessionId;
  const session = sessionId === null ? undefined : state.sessions[sessionId];
  if (session === undefined) {
    return <></>;
  }
  const messages = state.messages[session.id] ?? [];
  const interactions = state.interactionIds.flatMap((id) => {
    const interaction = state.interactions[id];
    return interaction?.sessionId === session.id ? [interaction] : [];
  });
  return (
    <MessageList
      sessionId={session.id}
      items={messages}
      onSelectAgent={(item) => store.openDetails({
        kind: "subagent",
        sessionId: session.id,
        toolUseId: item.toolUseId,
      })}
    >
      <div className="inline-runtime">
        {interactions.map((interaction) => <InteractionCard key={interaction.id} interaction={interaction} respond={(id, response) => props.api.respondToInteraction(id, response)} onSelect={(interactionId) => store.openDetails({ kind: "approval", sessionId: session.id, interactionId })} />)}
      </div>
    </MessageList>
  );
}
