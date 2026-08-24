import { resolve } from "node:path";
import { homedir } from "node:os";
import { AppError } from "./errors/app-error.js";
import type { SelectablePermissionMode } from "../shared/permissions.js";

export type ServerConfig = {
  host: "127.0.0.1" | "::1" | "localhost";
  port: number;
  assetRoot: string | null;
  dataDirectory: string;
  authMode: "cli" | "access-token";
  model: string;
  permissionMode: SelectablePermissionMode;
  eventCapacity: number;
  enableCheckpoints: boolean;
  rawEvents: boolean;
  allowedOrigins: ReadonlySet<string>;
  mcpConfigFile?: string;
};

function configError(message: string): AppError {
  return new AppError({
    code: "CONFIG_INVALID",
    message,
    status: 500,
    retryable: false,
  });
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw configError(`${name} must be true or false.`);
}

function parsePort(value: string | undefined): number {
  const port = value === undefined ? 8787 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw configError("QODER_WEBUI_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const host = environment.QODER_WEBUI_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw configError("QODER_WEBUI_HOST must be a loopback host.");
  }
  const port = parsePort(environment.QODER_WEBUI_PORT);
  const authMode = environment.QODER_WEBUI_AUTH ?? "cli";
  if (authMode !== "cli" && authMode !== "access-token") {
    throw configError(
      "QODER_WEBUI_AUTH must be cli or access-token.",
    );
  }
  const permissionMode =
    environment.QODER_WEBUI_PERMISSION_MODE ?? "default";
  const permissionModes = new Set([
    "default",
    "acceptEdits",
    "auto",
  ]);
  if (!permissionModes.has(permissionMode)) {
    throw configError("QODER_WEBUI_PERMISSION_MODE is not supported.");
  }
  const eventCapacity = Number(
    environment.QODER_WEBUI_EVENT_CAPACITY ?? "1000",
  );
  if (!Number.isSafeInteger(eventCapacity) || eventCapacity < 1) {
    throw configError(
      "QODER_WEBUI_EVENT_CAPACITY must be a positive integer.",
    );
  }
  const devOrigin =
    environment.QODER_WEBUI_DEV_ORIGIN ?? "http://127.0.0.1:5173";
  let parsedDevOrigin: URL;
  try {
    parsedDevOrigin = new URL(devOrigin);
  } catch (error) {
    throw new AppError(
      {
        code: "CONFIG_INVALID",
        message: "QODER_WEBUI_DEV_ORIGIN must be an HTTP(S) URL.",
        status: 500,
        retryable: false,
      },
      { cause: error },
    );
  }
  if (
    (parsedDevOrigin.protocol !== "http:" &&
      parsedDevOrigin.protocol !== "https:") ||
    !isLoopbackHostname(parsedDevOrigin.hostname)
  ) {
    throw configError(
      "QODER_WEBUI_DEV_ORIGIN must use HTTP(S) on a loopback host.",
    );
  }
  const productionOrigin =
    host === "::1" ? `http://[::1]:${port}` : `http://${host}:${port}`;
  return {
    host,
    port,
    assetRoot:
      environment.NODE_ENV === "production"
        ? resolve(process.cwd(), "dist/client")
        : null,
    dataDirectory:
      environment.QODER_WEBUI_DATA_DIR ??
      resolve(homedir(), ".qoder-agent-sdk-web-ui-showcase"),
    authMode,
    model: environment.QODER_WEBUI_MODEL?.trim() || "auto",
    permissionMode:
      permissionMode as ServerConfig["permissionMode"],
    eventCapacity,
    enableCheckpoints: parseBoolean(
      environment.QODER_WEBUI_CHECKPOINTS,
      true,
      "QODER_WEBUI_CHECKPOINTS",
    ),
    rawEvents: parseBoolean(
      environment.QODER_WEBUI_RAW_EVENTS,
      true,
      "QODER_WEBUI_RAW_EVENTS",
    ),
    allowedOrigins: new Set([productionOrigin, parsedDevOrigin.origin]),
    ...(environment.QODER_WEBUI_MCP_CONFIG_FILE === undefined ||
    environment.QODER_WEBUI_MCP_CONFIG_FILE.trim().length === 0
      ? {}
      : { mcpConfigFile: environment.QODER_WEBUI_MCP_CONFIG_FILE }),
  };
}
