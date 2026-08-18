import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateWorkspacePath } from "../../../../src/server/platform/path-policy.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "qoder-workspace-path-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("validateWorkspacePath", () => {
  it("rejects relative paths before filesystem access", async () => {
    await expect(validateWorkspacePath("relative/path")).rejects.toMatchObject({
      code: "WORKSPACE_PATH_NOT_ABSOLUTE",
    });
  });

  it("rejects a file instead of registering its parent", async () => {
    const directory = await makeTemporaryDirectory();
    const file = join(directory, "README.md");
    await writeFile(file, "sample", "utf8");

    await expect(validateWorkspacePath(file)).rejects.toMatchObject({
      code: "WORKSPACE_PATH_NOT_DIRECTORY",
    });
  });

  it("returns the canonical target for a symlinked directory", async () => {
    const directory = await makeTemporaryDirectory();
    const target = join(directory, "target");
    const link = join(directory, "link");
    await mkdir(target);
    await symlink(target, link, "dir");

    expect(await validateWorkspacePath(link)).toBe(await realpath(target));
  });
});
