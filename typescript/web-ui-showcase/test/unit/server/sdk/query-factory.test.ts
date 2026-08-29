import { describe, expect, it, vi } from "vitest";
import type {
  AuthOptions,
  Options,
  Query,
} from "@qoder-ai/qoder-agent-sdk";
import { loadServerConfig } from "../../../../src/server/config.js";
import {
  createQueryFactory,
  type QueryFunction,
} from "../../../../src/server/sdk/query-factory.js";
import { InputQueue } from "../../../../src/server/sdk/input-queue.js";
import { InteractionBroker } from "../../../../src/server/sdk/interaction-broker.js";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";

const sessionId = "00000000-0000-4000-8000-000000000501";

function createInteractions(): InteractionBroker {
  return new InteractionBroker({
    journal: new EventJournal({ epoch: "epoch-a", capacity: 10 }),
  });
}

function createInput(): InputQueue {
  return new InputQueue();
}

describe("QueryFactory", () => {
  it("constructs a long-lived streaming Query with showcase options", () => {
    const queryObject = {} as Query;
    const queryFn = vi.fn<QueryFunction>(() => queryObject);
    const auth = { type: "qodercli" } as AuthOptions;
    const qodercliAuth = vi.fn(() => auth);
    const factory = createQueryFactory({
      config: loadServerConfig({ QODER_WEBUI_AUTH: "cli" }),
      queryFn,
      authFactories: {
        qodercliAuth,
        accessTokenFromEnv: vi.fn(),
      },
    });
    const input = createInput();
    const interactions = createInteractions();

    expect(
      factory.create({
        workspacePath: "/repo",
        newSessionId: sessionId,
        input,
        interactions,
        getSessionId: () => sessionId,
        mcpServers: {},
        hooks: {},
      }),
    ).toBe(queryObject);
    expect(qodercliAuth).toHaveBeenCalledOnce();
    expect(queryFn).toHaveBeenCalledWith({
      prompt: input,
      options: {
        auth,
        cwd: "/repo",
        sessionId,
        model: "auto",
        permissionMode: "default",
        enableFileCheckpointing: true,
        includePartialMessages: true,
        includeHookEvents: true,
        promptSuggestions: true,
        canUseTool: expect.any(Function),
        onElicitation: expect.any(Function),
        mcpServers: {},
        hooks: {},
      },
    });
  });

  it("adds resume and fork only for the requested lifecycle", () => {
    const queryObject = {} as Query;
    const queryFn = vi.fn<QueryFunction>(() => queryObject);
    const factory = createQueryFactory({
      config: loadServerConfig({ QODER_WEBUI_AUTH: "cli" }),
      queryFn,
      authFactories: {
        qodercliAuth: () => ({ type: "qodercli" }),
        accessTokenFromEnv: vi.fn(),
      },
    });

    factory.create({
      workspacePath: "/repo",
      resumeSessionId: sessionId,
      forkSession: true,
      input: createInput(),
      interactions: createInteractions(),
      getSessionId: () => sessionId,
      mcpServers: {},
      hooks: {},
    });

    const options = queryFn.mock.calls[0]?.[0].options as Options;
    expect(options).toMatchObject({ resume: sessionId, forkSession: true });
    expect(options).not.toHaveProperty("sessionStore");
    expect(options).not.toHaveProperty("persistSession");
    expect(options).not.toHaveProperty("experimentalCloudAgent");
  });

  it("selects environment-backed access-token authentication", () => {
    const queryFn = vi.fn<QueryFunction>(() => ({} as Query));
    const auth = {
      type: "accessToken",
      accessToken: { envVar: "QODER_PERSONAL_ACCESS_TOKEN" },
    } as AuthOptions;
    const accessTokenFromEnv = vi.fn(() => auth);
    const factory = createQueryFactory({
      config: loadServerConfig({ QODER_WEBUI_AUTH: "access-token" }),
      queryFn,
      authFactories: {
        qodercliAuth: vi.fn(),
        accessTokenFromEnv,
      },
    });

    factory.create({
      workspacePath: "/repo",
      input: createInput(),
      interactions: createInteractions(),
      getSessionId: () => sessionId,
      mcpServers: {},
      hooks: {},
    });

    expect(accessTokenFromEnv).toHaveBeenCalledOnce();
    expect(queryFn.mock.calls[0]?.[0].options?.auth).toBe(auth);
  });

  it("rejects unsupported authentication and non-loopback origins at startup", () => {
    expect(() =>
      loadServerConfig({ QODER_WEBUI_AUTH: "browser-token" }),
    ).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
    expect(() =>
      loadServerConfig({
        QODER_WEBUI_DEV_ORIGIN: "https://example.com",
      }),
    ).toThrow(expect.objectContaining({ code: "CONFIG_INVALID" }));
  });
});
