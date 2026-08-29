import {
  accessTokenFromEnv,
  qodercliAuth,
  query,
  type AuthOptions,
  type Options,
  type PermissionMode,
  type Query,
} from "@qoder-ai/qoder-agent-sdk";
import type { ServerConfig } from "../config.js";
import type { InputQueue } from "./input-queue.js";
import type { InteractionBroker } from "./interaction-broker.js";
import { adaptQuery, type QueryPort } from "./query-port.js";

export type QueryFunction = (params: {
  prompt: string | AsyncIterable<
    import("@qoder-ai/qoder-agent-sdk").SDKUserMessage
  >;
  options?: Options;
}) => Query;

export type CreateQueryInput = {
  workspacePath: string;
  newSessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  model?: string;
  permissionMode?: PermissionMode;
  input: InputQueue;
  interactions: InteractionBroker;
  getSessionId: () => string;
  mcpServers: NonNullable<Options["mcpServers"]>;
  hooks: NonNullable<Options["hooks"]>;
};

export interface QueryFactory {
  create(input: CreateQueryInput): QueryPort;
}

type AuthFactories = {
  qodercliAuth: () => AuthOptions;
  accessTokenFromEnv: () => AuthOptions;
};

export function createQueryFactory(options: {
  config: ServerConfig;
  queryFn?: QueryFunction;
  authFactories?: AuthFactories;
}): QueryFactory {
  const queryFn = options.queryFn ?? query;
  const authFactories = options.authFactories ?? {
    qodercliAuth,
    accessTokenFromEnv,
  };

  return {
    create(input) {
      const auth =
        options.config.authMode === "cli"
          ? authFactories.qodercliAuth()
          : authFactories.accessTokenFromEnv();
      const sdkQuery = queryFn({
        prompt: input.input,
        options: {
          auth,
          cwd: input.workspacePath,
          ...(input.newSessionId === undefined
            ? {}
            : { sessionId: input.newSessionId }),
          model: input.model ?? options.config.model,
          permissionMode:
            input.permissionMode ?? options.config.permissionMode,
          enableFileCheckpointing: options.config.enableCheckpoints,
          includePartialMessages: true,
          includeHookEvents: true,
          promptSuggestions: true,
          canUseTool: input.interactions.canUseTool(input.getSessionId),
          onElicitation: input.interactions.onElicitation(input.getSessionId),
          mcpServers: input.mcpServers,
          hooks: input.hooks,
          ...(input.resumeSessionId === undefined
            ? {}
            : { resume: input.resumeSessionId }),
          ...(input.forkSession === undefined
            ? {}
            : { forkSession: input.forkSession }),
        },
      });
      return adaptQuery(sdkQuery);
    },
  };
}
