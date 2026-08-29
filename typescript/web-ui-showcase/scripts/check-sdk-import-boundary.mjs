import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

async function walk(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory()
        ? walk(join(directory, entry.name), relative)
        : [relative];
    }),
  );
  return nested.flat();
}

const paths = (await walk(sourceRoot)).filter((path) =>
  /\.[cm]?tsx?$/.test(path),
);
const files = await Promise.all(
  paths.map(async (path) => ({
    path,
    source: await readFile(join(sourceRoot, path), "utf8"),
  })),
);
const violations = files.filter(
  ({ path, source }) =>
    source.includes("@qoder-ai/qoder-agent-sdk") &&
    !path.startsWith("server/sdk/"),
);
if (violations.length > 0) {
  process.stderr.write(
    `SDK import boundary violations:\n${violations.map(({ path }) => path).join("\n")}\n`,
  );
  process.exitCode = 1;
}
