import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  createSdkMcpServer,
  query,
  tool,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";
import { z } from "zod";

type ServiceRecord = {
  build: { status: string; revision: string; completedAt: string };
  incidents: Array<{ id: string; severity: string; summary: string }>;
};

type SampleData = { services: Record<string, ServiceRecord> };

async function loadData(): Promise<SampleData> {
  const contents = await readFile(new URL("./data.json", import.meta.url), "utf8");
  return JSON.parse(contents) as SampleData;
}

export async function getService(service: string): Promise<ServiceRecord> {
  const record = (await loadData()).services[service];
  if (!record) throw new Error(`Unknown service: ${service}`);
  return record;
}

const getBuildStatus = tool(
  "get_build_status",
  "Return the latest CI build status for a service.",
  { service: z.string().describe("Service name") },
  async ({ service }) => {
    try {
      const { build } = await getService(service);
      return { content: [{ type: "text", text: JSON.stringify(build) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown service",
          },
        ],
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

const getOpenIncidents = tool(
  "get_open_incidents",
  "Return open production incidents for a service.",
  { service: z.string().describe("Service name") },
  async ({ service }) => {
    try {
      const { incidents } = await getService(service);
      return { content: [{ type: "text", text: JSON.stringify(incidents) }] };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : "Unknown service",
          },
        ],
      };
    }
  },
  { annotations: { readOnlyHint: true } },
);

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export async function run(service: string): Promise<void> {
  const serverName = "release_readiness";
  const server = createSdkMcpServer({
    name: serverName,
    version: "1.0.0",
    tools: [getBuildStatus, getOpenIncidents],
  });
  const toolNames = [
    `mcp__${serverName}__get_build_status`,
    `mcp__${serverName}__get_open_incidents`,
  ];
  const stream = query({
    prompt: `Use both available tools to assess whether ${service} is ready to release. Cite the build revision and every open incident in a concise recommendation.`,
    options: {
      auth: accessTokenFromEnv(),
      model: "auto",
      mcpServers: { [serverName]: server },
      tools: toolNames,
      allowedTools: toolNames,
      maxTurns: 4,
    },
  });

  let completed = false;
  try {
    for await (const message of stream) {
      for (const text of assistantText(message)) process.stdout.write(text);
      if (message.type === "result") {
        if (message.subtype !== "success") {
          throw new Error(message.errors?.join("\n") || message.subtype);
        }
        completed = true;
      }
    }
  } finally {
    await stream.close();
  }
  if (!completed) throw new Error("The query ended without a success result.");
  process.stdout.write("\n");
}

async function main(): Promise<void> {
  await run(process.argv[2] ?? "payments-api");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
