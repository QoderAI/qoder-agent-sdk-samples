import { useEffect, useState } from "react";
import type {
  CheckpointExecuteCommand,
  CheckpointPreviewCommand,
  InteractionResponse,
  SendMessageInput,
} from "../../../shared/commands.js";
import type { ConversationItem } from "../../../shared/model.js";
import type { WorkspaceFileSearchResult } from "../../../shared/workspace-files.js";
import type { SubagentTranscriptResponse } from "../../../shared/subagents.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { InteractionCard } from "../interactions/interaction-card.js";
import { CheckpointDialog } from "./checkpoint-dialog.js";
import { MessageList } from "./message-list.js";

type Accepted = { commandId: string };
type UserMessage = Extract<ConversationItem, { kind: "user" }>;
type CheckpointSelection = {
  item: UserMessage;
  trigger: HTMLButtonElement;
};

export type ConversationApi = {
  sendMessage(sessionId: string, input: SendMessageInput): Promise<Accepted>;
  cancelMessage(sessionId: string, uuid: string): Promise<Accepted>;
  respondToInteraction(id: string, response: InteractionResponse): Promise<Accepted>;
  stopTask(sessionId: string, taskId: string): Promise<Accepted>;
  backgroundTasks(sessionId: string, toolUseId?: string): Promise<Accepted>;
  interruptSession(sessionId: string): Promise<Accepted>;
  refreshContext(sessionId: string): Promise<Accepted>;
  previewCheckpoint(
    sessionId: string,
    input: CheckpointPreviewCommand,
  ): Promise<Accepted>;
  executeCheckpoint(
    sessionId: string,
    input: CheckpointExecuteCommand,
  ): Promise<Accepted>;
  searchWorkspaceFiles(
    sessionId: string,
    query: string,
    signal?: AbortSignal,
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
  const [checkpoint, setCheckpoint] = useState<CheckpointSelection>();
  useEffect(() => {
    setCheckpoint(undefined);
  }, [sessionId]);
  const session = sessionId === null ? undefined : state.sessions[sessionId];
  if (session === undefined) {
    return <></>;
  }
  const messages = state.messages[session.id] ?? [];
  const interactions = state.interactionIds.flatMap((id) => {
    const interaction = state.interactions[id];
    return interaction?.sessionId === session.id ? [interaction] : [];
  });
  const checkpointAvailable =
    session.checkpointEnabled !== false &&
    session.phase === "idle" &&
    interactions.length === 0;
  return (
    <>
      <MessageList
        sessionId={session.id}
        items={messages}
        onSelectAgent={(item) => store.openDetails({
          kind: "subagent",
          sessionId: session.id,
          toolUseId: item.toolUseId,
        })}
        {...(!checkpointAvailable
          ? {}
          : {
              onCheckpoint: (item: UserMessage, trigger: HTMLButtonElement) =>
                setCheckpoint({ item, trigger }),
            })}
      >
        <div className="inline-runtime">
          {interactions.map((interaction) => <InteractionCard key={interaction.id} interaction={interaction} respond={(id, response) => props.api.respondToInteraction(id, response)} onSelect={(interactionId) => store.openDetails({ kind: "approval", sessionId: session.id, interactionId })} />)}
        </div>
      </MessageList>
      {checkpoint === undefined ? null : (
        <CheckpointDialog
          api={props.api}
          session={session}
          target={checkpoint.item}
          returnFocus={checkpoint.trigger}
          onClose={() => setCheckpoint(undefined)}
        />
      )}
    </>
  );
}
