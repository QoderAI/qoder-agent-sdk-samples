import { readFile } from "node:fs/promises";
import type {
  McpHttpServerConfig,
  McpServerConfig,
  McpServerToolPolicy,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from "@qoder-ai/qoder-agent-sdk";
import { z } from "zod";
import { AppError } from "../errors/app-error.js";
import { createDemoMcpServer } from "./demo-mcp-server.js";

export type McpServerMap = Record<string, McpServerConfig>;

const toolPolicySchema = z
  .object({
    name: z.string().trim().min(1),
    permission_policy: z
      .enum(["always_allow", "always_ask", "always_deny"])
      .optional(),
    exposedName: z.string().trim().min(1).optional(),
    alwaysLoad: z.boolean().optional(),
  })
  .strict();

const remoteCommon = {
  timeout: z.number().int().min(1_000).optional(),
  tools: z.array(toolPolicySchema).optional(),
};
const stdioSchema = z
  .object({
    type: z.literal("stdio").optional(),
    command: z.string().trim().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    ...remoteCommon,
  })
  .strict();
const remoteUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Remote MCP URLs must use HTTP or HTTPS.");
const sseSchema = z
  .object({
    type: z.literal("sse"),
    url: remoteUrlSchema,
    headers: z.record(z.string(), z.string()).optional(),
    ...remoteCommon,
  })
  .strict();
const httpSchema = z
  .object({
    type: z.literal("http"),
    url: remoteUrlSchema,
    headers: z.record(z.string(), z.string()).optional(),
    ...remoteCommon,
  })
  .strict();
const remoteServersSchema = z.record(
  z.string().trim().min(1),
  z.union([stdioSchema, sseSchema, httpSchema]),
);

type ParsedPolicy = z.infer<typeof toolPolicySchema>;
type ParsedRemote = z.infer<typeof remoteServersSchema>[string];

function policies(
  input: ParsedPolicy[] | undefined,
): McpServerToolPolicy[] | undefined {
  return input?.map((policy) => ({
    name: policy.name,
    ...(policy.permission_policy === undefined
      ? {}
      : { permission_policy: policy.permission_policy }),
    ...(policy.exposedName === undefined
      ? {}
      : { exposedName: policy.exposedName }),
    ...(policy.alwaysLoad === undefined
      ? {}
      : { alwaysLoad: policy.alwaysLoad }),
  }));
}

function remoteConfig(input: ParsedRemote): McpServerConfig {
  const parsedPolicies = policies(input.tools);
  const common = {
    ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
    ...(parsedPolicies === undefined ? {} : { tools: parsedPolicies }),
  };
  if ("command" in input) {
    const config: McpStdioServerConfig = {
      type: "stdio",
      command: input.command,
      ...(input.args === undefined ? {} : { args: input.args }),
      ...(input.env === undefined ? {} : { env: input.env }),
      ...common,
    };
    return config;
  }
  if (input.type === "sse") {
    const config: McpSSEServerConfig = {
      type: "sse",
      url: input.url,
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      ...common,
    };
    return config;
  }
  const config: McpHttpServerConfig = {
    type: "http",
    url: input.url,
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    ...common,
  };
  return config;
}

/** Reads and validates server-only MCP configuration once during startup. */
export async function loadRemoteMcpServers(
  configFile?: string,
): Promise<McpServerMap> {
  if (configFile === undefined) {
    return {};
  }
  try {
    const parsedJson: unknown = JSON.parse(await readFile(configFile, "utf8"));
    const parsed = remoteServersSchema.parse(parsedJson);
    if (parsed.showcase_project !== undefined) {
      throw new AppError({
        code: "MCP_CONFIG_INVALID",
        message: "Remote MCP configuration cannot replace showcase_project.",
        status: 500,
        retryable: false,
      });
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([name, config]) => [
        name,
        remoteConfig(config),
      ]),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      {
        code: "MCP_CONFIG_INVALID",
        message: "The MCP configuration file is not valid.",
        status: 500,
        retryable: false,
      },
      { cause: error },
    );
  }
}

/** Adds the Workspace-scoped showcase server to validated remote servers. */
export function createMcpServers(
  workspacePath: string,
  remoteServers: McpServerMap,
): McpServerMap {
  return {
    showcase_project: createDemoMcpServer(workspacePath),
    ...remoteServers,
  };
}
