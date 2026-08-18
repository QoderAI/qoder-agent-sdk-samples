import type {
  BYOKModelValidationInput,
  PermissionMode,
  Query,
  RewindScope,
  SDKMessage,
  Settings,
} from "@qoder-ai/qoder-agent-sdk";

export type QueryMessage = SDKMessage;

export interface QueryPort extends AsyncIterable<QueryMessage> {
  initializationResult(): ReturnType<Query["initializationResult"]>;
  interrupt(): ReturnType<Query["interrupt"]>;
  cancelAsyncMessage(uuid: string): Promise<boolean>;
  stopTask(taskId: string): Promise<void>;
  backgroundTasks(toolUseId?: string): Promise<boolean>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  setModel(model?: string): Promise<void>;
  setProxy(proxy?: string | null): Promise<void>;
  addDirectories(
    directories: string[],
  ): ReturnType<Query["addDirectories"]>;
  mcpServerStatus(): ReturnType<Query["mcpServerStatus"]>;
  mcpAuthenticate(
    name: string,
    redirectUri?: string,
  ): ReturnType<Query["mcpAuthenticate"]>;
  mcpSubmitOAuthCallbackUrl(
    name: string,
    callbackUrl: string,
  ): Promise<void>;
  getContextUsage(): ReturnType<Query["getContextUsage"]>;
  getUsageInfo(): ReturnType<Query["getUsageInfo"]>;
  accountInfo(): ReturnType<Query["accountInfo"]>;
  getAvailableModels(
    options?: Parameters<Query["getAvailableModels"]>[0],
  ): ReturnType<Query["getAvailableModels"]>;
  supportedCommands(): ReturnType<Query["supportedCommands"]>;
  supportedAgents(): ReturnType<Query["supportedAgents"]>;
  listPlugins(): ReturnType<Query["listPlugins"]>;
  reloadPlugins(): ReturnType<Query["reloadPlugins"]>;
  listByokProviders(): ReturnType<Query["listByokProviders"]>;
  validateByokModel(input: BYOKModelValidationInput): Promise<boolean | null>;
  applyFlagSettings(settings: Settings): Promise<void>;
  generateSessionTitle(
    description: string,
    options?: { persist?: boolean },
  ): ReturnType<Query["generateSessionTitle"]>;
  rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): ReturnType<Query["rewindFiles"]>;
  rewind(
    userMessageId: string,
    options?: { scope?: RewindScope; dryRun?: boolean },
  ): ReturnType<Query["rewind"]>;
  seedReadState(path: string, mtime: number): Promise<void>;
  close(): Promise<void>;
}

export function adaptQuery(query: Query): QueryPort {
  return query;
}
