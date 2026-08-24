import { describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@qoder-ai/qoder-agent-sdk";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { InputQueue } from "../../src/server/sdk/input-queue.js";
import { InteractionBroker } from "../../src/server/sdk/interaction-broker.js";
import { McpService } from "../../src/server/sdk/mcp-service.js";
import type { QueryPort } from "../../src/server/sdk/query-port.js";
import { SessionController } from "../../src/server/sdk/session-controller.js";
import { SessionRegistry } from "../../src/server/sdk/session-registry.js";

const sessionId = "00000000-0000-4000-8000-000000000801";

function pendingMessages(): AsyncIterable<SDKMessage> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(() => undefined) };
    },
  };
}

function queryWithMcp() {
  const order: string[] = [];
  const messages = pendingMessages();
  const mcpServerStatus = vi.fn(
    async (): ReturnType<QueryPort["mcpServerStatus"]> => {
    order.push("status");
    return [{ name: "github", status: "needs-auth" as const }];
    },
  );
  const mcpAuthenticate = vi.fn(
    async (): ReturnType<QueryPort["mcpAuthenticate"]> => ({
      requiresUserAction: false,
    }),
  );
  const mcpSubmitOAuthCallbackUrl = vi.fn(async () => undefined);
  const query = {
    [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
    initializationResult: async () => {
      order.push("initialize");
      return { capabilities: [] };
    },
    mcpServerStatus,
    mcpAuthenticate,
    mcpSubmitOAuthCallbackUrl,
    close: async () => undefined,
  } as unknown as QueryPort;
  return {
    query,
    order,
    mcpServerStatus,
    mcpAuthenticate,
    mcpSubmitOAuthCallbackUrl,
  };
}

async function setup() {
  const journal = new EventJournal({ epoch: "epoch-mcp", capacity: 100 });
  const registry = new SessionRegistry();
  const restartSession = vi.fn(async () => undefined);
  const mcp = new McpService({ journal, registry, restartSession });
  const input = new InputQueue();
  const interactions = new InteractionBroker({ journal });
  const fake = queryWithMcp();
  const controller = new SessionController({
    initialModel: "auto",
    initialPermissionMode: "default",
    sessionId,
    query: fake.query,
    input,
    interactions,
    journal,
    mcp,
  });
  controller.attachRegistryRelease(registry.reserve(sessionId, controller));
  await controller.start();
  return { journal, registry, restartSession, mcp, input, fake, controller };
}

describe("MCP lifecycle", () => {
  it("keeps a terminal Session operation behind in-flight authentication", async () => {
    const { fake, registry, mcp } = await setup();
    let releaseAuthentication: (() => void) | undefined;
    const authenticationGate = new Promise<{ requiresUserAction: false }>(
      (resolve) => {
        releaseAuthentication = () => resolve({ requiresUserAction: false });
      },
    );
    fake.mcpAuthenticate.mockImplementationOnce(() => authenticationGate);

    const authentication = mcp.authenticate(sessionId, "github");
    await vi.waitFor(() => expect(fake.mcpAuthenticate).toHaveBeenCalledOnce());
    let terminalStarted = false;
    const terminal = registry.runExclusive(sessionId, async () => {
      terminalStarted = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalStarted).toBe(false);

    releaseAuthentication?.();
    await Promise.all([authentication, terminal]);
    expect(terminalStarted).toBe(true);
  });

  it("checks status before accepting messages and gates needs-auth servers", async () => {
    const { fake, controller, input, mcp } = await setup();

    expect(fake.order).toEqual(["initialize", "status"]);
    expect(mcp.snapshot()).toMatchObject([
      { sessionId, name: "github", status: "needs-auth" },
    ]);
    expect(() =>
      controller.send({ text: "hello", priority: "next", shouldQuery: true }),
    ).toThrow(expect.objectContaining({ code: "MCP_AUTH_REQUIRED" }));
    expect(input.list()).toEqual([]);
  });

  it("redacts and bounds browser-facing MCP metadata", async () => {
    const journal = new EventJournal({ epoch: "epoch-mcp-metadata", capacity: 100 });
    const registry = new SessionRegistry();
    const mcp = new McpService({
      journal,
      registry,
      restartSession: vi.fn(async () => undefined),
    });
    const tools = Array.from({ length: 120 }, (_, index) => ({
      name: `tool-${index}`,
      description: index === 0
        ? [
            "Inspect a repository.",
            "Authorization: Bearer mcp-description-secret",
            "    at inspect (/private/mcp-description-stack.ts:12:4)",
          ].join("\n")
        : `Tool ${index}`,
      annotations: {
        readOnlyHint: true,
        apiKey: `mcp-annotation-secret-${index}`,
      },
    }));
    const query = {
      mcpServerStatus: vi.fn(async () => [{
        name: "metadata-server",
        status: "connected",
        serverInfo: {
          name: "fixture",
          version: "1.0.0",
          accessToken: "mcp-server-info-secret",
        },
        tools,
      }]),
    } as unknown as QueryPort;

    const [view] = await mcp.preflight(sessionId, query);
    expect(view?.serverInfo).toMatchObject({
      name: "fixture",
      accessToken: "[REDACTED]",
    });
    expect(view?.tools).toHaveLength(100);
    expect(view?.tools?.[0]).toMatchObject({
      name: "tool-0",
      description: "Inspect a repository.",
      annotations: { apiKey: "[REDACTED]" },
    });
    expect(view?.tools?.at(-1)).toMatchObject({
      name: "Additional MCP tools omitted",
      omittedTools: 21,
    });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("mcp-description-secret");
    expect(serialized).not.toContain("mcp-description-stack");
    expect(serialized).not.toContain("mcp-server-info-secret");
    expect(serialized).not.toContain("mcp-annotation-secret");
  });

  it("uses a bounded fallback for malformed MCP metadata", async () => {
    const journal = new EventJournal({ epoch: "epoch-mcp-malformed", capacity: 100 });
    const registry = new SessionRegistry();
    const mcp = new McpService({
      journal,
      registry,
      restartSession: vi.fn(async () => undefined),
    });
    const circular: unknown[] = [];
    circular.push(circular);
    const query = {
      mcpServerStatus: vi.fn(async () => [{
        name: "malformed-server",
        status: "connected",
        tools: circular,
      }]),
    } as unknown as QueryPort;

    await expect(mcp.preflight(sessionId, query)).resolves.toMatchObject([
      {
        tools: [{
          name: "MCP tool 1",
          metadataUnavailable: true,
        }],
      },
    ]);
    const serialized = JSON.stringify(mcp.snapshot());
    expect(new TextEncoder().encode(serialized).length).toBeLessThan(64 * 1_024);
  });

  it("supports silent OAuth, user-action URLs, callbacks, and restart reconnect", async () => {
    const { fake, journal, mcp, restartSession } = await setup();

    await mcp.authenticate(sessionId, "github");
    expect(mcp.snapshot()).toMatchObject([
      { name: "github", status: "connected" },
    ]);

    fake.mcpAuthenticate.mockResolvedValueOnce({
      requiresUserAction: true,
      authUrl: "https://auth.example/authorize",
    });
    await mcp.authenticate(sessionId, "github");
    expect(mcp.snapshot()).toMatchObject([
      {
        name: "github",
        status: "needs-auth",
        authUrl: "https://auth.example/authorize",
      },
    ]);

    fake.mcpServerStatus.mockResolvedValueOnce([
      { name: "github", status: "connected" },
    ]);
    const callbackUrl =
      "http://127.0.0.1/callback?code=oauth-callback-secret";
    await mcp.submitCallback(sessionId, "github", callbackUrl);
    expect(fake.mcpSubmitOAuthCallbackUrl).toHaveBeenCalledWith(
      "github",
      callbackUrl,
    );
    expect(JSON.stringify(journal.replay({ epoch: "epoch-mcp", after: 0 })))
      .not.toContain("oauth-callback-secret");

    await mcp.reconnect(sessionId, "github");
    expect(restartSession).toHaveBeenCalledWith(sessionId);
  });
});
