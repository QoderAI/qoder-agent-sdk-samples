import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listProjectEntries } from "../../../../src/server/sdk/demo-mcp-server.js";

let directory: string | undefined;

afterEach(async () => {
  if (directory !== undefined) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("showcase_project MCP server", () => {
  it("lists sorted top-level entry names and kinds without reading files", async () => {
    directory = await mkdtemp(join(tmpdir(), "qoder-demo-mcp-"));
    await writeFile(join(directory, ".env"), "SECRET=not-for-the-model\n");
    await writeFile(join(directory, "README.md"), "# Project\n");
    await mkdir(join(directory, "src"));

    expect(await listProjectEntries(directory)).toEqual({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { name: ".env", kind: "file" },
            { name: "README.md", kind: "file" },
            { name: "src", kind: "directory" },
          ]),
        },
      ],
    });
  });
});
