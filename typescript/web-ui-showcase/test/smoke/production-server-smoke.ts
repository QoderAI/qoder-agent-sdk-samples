import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not reserve a loopback port.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function waitForHealth(origin: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // The child process has not bound its loopback port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Production server did not become healthy within 10 seconds.");
}

const port = await reservePort();
const dataDirectory = await mkdtemp(join(tmpdir(), "qoder-webui-production-"));
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "scripts/start-production.mjs"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "",
      QODER_WEBUI_DATA_DIR: dataDirectory,
      QODER_WEBUI_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  output += chunk;
});
child.stderr.on("data", (chunk: string) => {
  output += chunk;
});

try {
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin);
  const response = await fetch(`${origin}/`);
  const body = await response.text();
  if (!response.ok || !body.includes('<div id="root"></div>')) {
    throw new Error(
      `Production root did not serve the Web UI: ${response.status}.\n${output}`,
    );
  }
  console.log("PASS production server serves the built Web UI.");
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
  });
  await rm(dataDirectory, { recursive: true, force: true });
}
