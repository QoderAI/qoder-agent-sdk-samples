import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  query,
  type CanUseTool,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";

const ALLOWED_COMMANDS = new Set([
  "git status --short",
  "git status --porcelain",
  "git --no-pager status --short",
  "git --no-pager status --porcelain",
]);

export const authorizeTool: CanUseTool = async (toolName, input) => {
  if (toolName !== "Bash") {
    return { behavior: "deny", message: `Tool ${toolName} is not permitted.` };
  }

  const command = typeof input.command === "string" ? input.command.trim() : "";
  if (!ALLOWED_COMMANDS.has(command)) {
    console.log(`[permission] denied Bash: ${command || "<missing command>"}`);
    return {
      behavior: "deny",
      message: "Only a read-only git status command is permitted.",
    };
  }

  console.log(`[permission] allowed Bash: ${command}`);
  return { behavior: "allow", updatedInput: input };
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
      "Run exactly `git --no-pager status --short`, then explain the repository status in one sentence. Do not modify any files.",
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      tools: ["Read", "Glob", "Grep", "Bash"],
      allowedTools: ["Read", "Glob", "Grep"],
      permissionMode: "default",
      canUseTool: authorizeTool,
      maxTurns: 3,
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
