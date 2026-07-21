import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  query,
  type AgentDefinition,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";

export const agents: Record<string, AgentDefinition> = {
  "architecture-explorer": {
    description: "Maps the repository architecture and important boundaries.",
    prompt:
      "Inspect the repository with read-only tools. Report the main modules, their responsibilities, dependencies, and architectural risks. Do not modify files.",
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 5,
  },
  "test-strategist": {
    description: "Evaluates the test strategy for a proposed migration.",
    prompt:
      "Inspect tests and production code with read-only tools. Identify critical behaviors, coverage gaps, and a practical migration verification plan. Do not modify files.",
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 5,
  },
};

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export async function run(workspace: string): Promise<void> {
  const stream = query({
    prompt:
      "Ask architecture-explorer to map the repository, then ask test-strategist to design verification for a major dependency upgrade. Synthesize their findings into a concise migration plan with ordered steps and risks.",
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      agents,
      tools: ["Agent"],
      allowedTools: ["Agent"],
      maxTurns: 8,
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
  await run(resolve(process.argv[2] ?? process.cwd()));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
