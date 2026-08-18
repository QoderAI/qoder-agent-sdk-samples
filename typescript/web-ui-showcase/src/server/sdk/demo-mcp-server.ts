import { readdir } from "node:fs/promises";
import {
  createSdkMcpServer,
  tool,
  type CallToolResult,
} from "@qoder-ai/qoder-agent-sdk";

type ProjectEntry = {
  name: string;
  kind: "file" | "directory" | "other";
};

/** Lists top-level entry metadata without reading file contents. */
export async function listProjectEntries(
  workspacePath: string,
): Promise<CallToolResult> {
  const entries = await readdir(workspacePath, { withFileTypes: true });
  const view: ProjectEntry[] = entries
    .map((entry): ProjectEntry => ({
      name: entry.name,
      kind: entry.isFile()
        ? "file"
        : entry.isDirectory()
          ? "directory"
          : "other",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    content: [{ type: "text", text: JSON.stringify(view) }],
  };
}

/** Creates the in-process, read-only MCP server shown by this sample. */
export function createDemoMcpServer(workspacePath: string) {
  return createSdkMcpServer({
    name: "showcase_project",
    tools: [
      tool(
        "list_project_entries",
        "List the selected project's top-level files and directories without reading file contents.",
        {},
        async () => listProjectEntries(workspacePath),
        {
          annotations: { readOnlyHint: true },
          permissionPolicy: "always_allow",
        },
      ),
    ],
  });
}
