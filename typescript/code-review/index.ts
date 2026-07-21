import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  accessTokenFromEnv,
  query,
  type SDKMessage,
} from "@qoder-ai/qoder-agent-sdk";

const MAX_DIFF_BYTES = 100_000;

export function validateGitRef(ref: string): string {
  if (ref.startsWith("-") || !/^[A-Za-z0-9._/@{}^~:+-]+$/.test(ref)) {
    throw new Error(`Invalid Git revision: ${ref}`);
  }
  return ref;
}

export function readDiff(
  workspace: string,
  base?: string,
  head = "HEAD",
): string {
  const revisions = base
    ? [`${validateGitRef(base)}...${validateGitRef(head)}`]
    : [validateGitRef(head)];
  let diff: string;
  try {
    diff = execFileSync(
      "git",
      ["diff", "--no-ext-diff", "--unified=40", ...revisions, "--"],
      { cwd: workspace, encoding: "utf8", maxBuffer: MAX_DIFF_BYTES + 1 },
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOBUFS")) {
      throw new Error("The diff is larger than 100 KB; review a smaller change.");
    }
    throw error;
  }
  if (!diff.trim()) {
    throw new Error(
      base
        ? `No changes found between ${base} and ${head}.`
        : `No working-tree changes found relative to ${head}.`,
    );
  }
  if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) {
    throw new Error("The diff is larger than 100 KB; review a smaller change.");
  }
  return diff;
}

function assistantText(message: SDKMessage): string[] {
  if (message.type !== "assistant") return [];
  const content = message.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    block.type === "text" ? [block.text] : [],
  );
}

export async function review(workspace: string, diff: string): Promise<void> {
  const stream = query({
    prompt: `Review the following Git diff. Use the repository only to understand surrounding code. Report only concrete correctness, security, reliability, or maintainability problems introduced by the change. For each finding include severity, file, location, explanation, and a specific fix. If there are no findings, say so.\n\n<git_diff>\n${diff}\n</git_diff>`,
    options: {
      auth: accessTokenFromEnv(),
      cwd: workspace,
      model: "auto",
      tools: ["Read", "Glob", "Grep"],
      allowedTools: ["Read", "Glob", "Grep"],
      maxTurns: 6,
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
  if (!completed) throw new Error("The review ended without a success result.");
  process.stdout.write("\n");
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const workspace = resolve(option("--workspace") ?? process.cwd());
  const base = option("--base");
  const head = option("--head") ?? "HEAD";
  await review(workspace, readDiff(workspace, base, head));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
