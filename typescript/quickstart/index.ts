import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  query,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";

export function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export async function run(workspace: string, prompt: string): Promise<void> {
  const stream = query({
    prompt,
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
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
  const workspace = resolve(process.argv[2] ?? process.cwd());
  const prompt =
    process.argv.slice(3).join(" ") ||
    "Explain the purpose of this repository and identify its most important files.";
  await run(workspace, prompt);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
