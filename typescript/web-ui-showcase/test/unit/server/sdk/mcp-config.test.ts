import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRemoteMcpServers } from "../../../../src/server/sdk/mcp-config.js";

let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

async function configFile(value: unknown): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), "qoder-mcp-config-"));
  const path = join(directory, "mcp.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

describe("remote MCP configuration", () => {
  it("accepts strict stdio and HTTP server configuration", async () => {
    const path = await configFile({
      local: { command: "node", args: ["server.js"], timeout: 1_000 },
      docs: {
        type: "http",
        url: "https://mcp.example/api",
        tools: [
          {
            name: "search",
            permission_policy: "always_ask",
            alwaysLoad: true,
          },
        ],
      },
    });

    await expect(loadRemoteMcpServers(path)).resolves.toMatchObject({
      local: { type: "stdio", command: "node", args: ["server.js"] },
      docs: { type: "http", url: "https://mcp.example/api" },
    });
  });

  it("rejects unsafe URLs, unknown fields, and showcase name replacement", async () => {
    for (const value of [
      { docs: { type: "http", url: "file:///tmp/socket" } },
      { docs: { type: "http", url: "https://mcp.example", secret: true } },
      { showcase_project: { command: "replace-demo" } },
    ]) {
      await expect(
        loadRemoteMcpServers(await configFile(value)),
      ).rejects.toMatchObject({ code: "MCP_CONFIG_INVALID" });
    }
  });
});
