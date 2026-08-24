import type { WireError } from "../../shared/errors.js";
import type { DetailsSelection } from "../features/layout/details-selection.js";
import type { CommandOwnership } from "./command-ownership.js";
import type {
  ConversationItem,
  CheckpointPreviewView,
  SessionRuntimeView,
  InteractionView,
  McpServerView,
  QueuedInputView,
  SessionView,
  TaskView,
  WorkspaceView,
} from "../../shared/model.js";

export type ConnectionState = "disconnected" | "connecting" | "connected";
export type CommandFailureView = {
  commandId?: string;
  sessionId?: string;
  error: WireError;
};
export type CheckpointCompletionView = {
  sessionId: string;
  previewId: string;
  status: "success" | "partial";
  failedFiles: string[];
};
export type SdkConsoleTab =
  | "hooks"
  | "raw-events"
  | "mcp"
  | "skills"
  | "agents"
  | "plugins"
  | "account";

/** Product-owned layout state that never arrives in a server snapshot. */
export type ProductViewState = {
  sidebarWidth: number;
  preferredDetailsWidth: number;
  detailsSelection: DetailsSelection;
  settingsOpen: boolean;
  sdkConsoleOpen: boolean;
  sdkConsoleTab: SdkConsoleTab;
  /** Workspace the home hero should target; null falls back to the most recent one. */
  homeWorkspaceId: string | null;
};

export type AppState = ProductViewState & {
  serverEpoch: string | null;
  cursor: number;
  workspaceIds: string[];
  workspaces: Record<string, WorkspaceView>;
  sessionIds: string[];
  sessions: Record<string, SessionView>;
  messages: Record<string, ConversationItem[]>;
  queuedInputIds: string[];
  queuedInputs: Record<string, QueuedInputView>;
  interactionIds: string[];
  interactions: Record<string, InteractionView>;
  taskIds: string[];
  tasks: Record<string, TaskView>;
  mcpServerIds: string[];
  mcpServers: Record<string, McpServerView>;
  checkpointPreviewIds: string[];
  checkpointPreviews: Record<string, CheckpointPreviewView>;
  checkpointCompletions: Record<string, CheckpointCompletionView>;
  runtime: Record<string, SessionRuntimeView>;
  commandFailures: CommandFailureView[];
  commandOwnerships: CommandOwnership[];
  selectedSessionId: string | null;
  connectionState: ConnectionState;
  protocolError: WireError | null;
};
