import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  query,
  type HookCallback,
  type HookEvent,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";

const SAFE_STATUS_COMMANDS = new Set([
  "git status --short",
  "git status --porcelain",
  "git --no-pager status --short",
  "git --no-pager status --porcelain",
]);

const DEFAULT_PROMPT =
  "Run exactly `git --no-pager status --short`, read README.md, then explain in two sentences what this repository contains and whether it has uncommitted changes.";

const eventCounts = new Map<HookEvent, number>();

function record(event: HookEvent, detail: string): void {
  eventCounts.set(event, (eventCounts.get(event) ?? 0) + 1);
  console.log(`[hook:${event}] ${detail}`);
}

const onSessionStart: HookCallback = async (input) => {
  if (input.hook_event_name !== "SessionStart") return {};
  record("SessionStart", `source=${input.source}`);
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext:
        "This application is running a read-only repository inspection session.",
    },
  };
};

const onPromptSubmit: HookCallback = async (input) => {
  if (input.hook_event_name !== "UserPromptSubmit") return {};
  record("UserPromptSubmit", `received ${input.prompt.length} characters`);
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext:
        "Report only observed repository facts and do not propose file changes.",
    },
  };
};

const beforeBash: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse" || input.tool_name !== "Bash") {
    return {};
  }
  const toolInput = input.tool_input as { command?: unknown };
  const command =
    typeof toolInput.command === "string" ? toolInput.command.trim() : "";
  if (!SAFE_STATUS_COMMANDS.has(command)) {
    record("PreToolUse", `denied Bash: ${command || "<missing command>"}`);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "This sample permits only a read-only git status command.",
      },
    };
  }
  record("PreToolUse", `allowed Bash: ${command}`);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "The command matches the read-only policy.",
    },
  };
};

const afterTool: HookCallback = async (input) => {
  if (input.hook_event_name !== "PostToolUse") return {};
  record("PostToolUse", `completed ${input.tool_name}`);
  if (input.tool_name !== "Bash") return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "The host application audited the git status command successfully.",
    },
  };
};

const onStop: HookCallback = async (input) => {
  if (input.hook_event_name !== "Stop") return {};
  record("Stop", "assistant finished generating");
  return {};
};

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export async function run(workspace: string, prompt: string): Promise<void> {
  eventCounts.clear();
  const stream = query({
    prompt,
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      tools: ["Read", "Bash"],
      allowedTools: ["Read", "Bash"],
      maxTurns: 4,
      hooks: {
        SessionStart: [{ hooks: [onSessionStart] }],
        UserPromptSubmit: [{ hooks: [onPromptSubmit] }],
        PreToolUse: [{ matcher: "Bash", hooks: [beforeBash] }],
        PostToolUse: [{ hooks: [afterTool] }],
        Stop: [{ hooks: [onStop] }],
      },
    },
  });

  let completed = false;
  try {
    for await (const message of stream) {
      for (const text of assistantText(message)) console.log(text);
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

  console.log("\n\nHook summary:");
  for (const [event, count] of eventCounts) {
    console.log(`- ${event}: ${count}`);
  }
}

async function main(): Promise<void> {
  const workspace = resolve(process.argv[2] ?? process.cwd());
  const prompt = process.argv.slice(3).join(" ") || DEFAULT_PROMPT;
  await run(workspace, prompt);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
