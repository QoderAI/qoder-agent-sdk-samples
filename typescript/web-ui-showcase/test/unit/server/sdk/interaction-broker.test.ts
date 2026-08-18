import { describe, expect, it, vi } from "vitest";
import type {
  CanUseToolOptions,
  PermissionUpdate,
} from "@qoder-ai/qoder-agent-sdk";
import { InteractionBroker } from "../../../../src/server/sdk/interaction-broker.js";
import { EventJournal } from "../../../../src/server/realtime/event-journal.js";
import { parseMcpElicitationSchema } from "../../../../src/shared/mcp-elicitation-schema.js";

const sessionId = "00000000-0000-4000-8000-000000000301";
const interactionId = "00000000-0000-4000-8000-000000000302";

function createBroker(): {
  broker: InteractionBroker;
  journal: EventJournal;
} {
  const journal = new EventJournal({
    epoch: "epoch-a",
    capacity: 30,
    now: () => "2026-08-14T08:00:00.000Z",
  });
  return {
    journal,
    broker: new InteractionBroker({
      journal,
      createUuid: () => interactionId,
      now: () => "2026-08-14T08:00:00.000Z",
    }),
  };
}

function toolOptions(
  signal: AbortSignal,
  suggestions?: PermissionUpdate[],
): CanUseToolOptions {
  return {
    signal,
    toolUseID: "tool-use-1",
    ...(suggestions === undefined ? {} : { suggestions }),
  };
}

function parseBrowserSchema(
  view: Extract<ReturnType<InteractionBroker["pending"]>[number], {
    kind: "mcp-elicitation";
  }>,
) {
  return parseMcpElicitationSchema(
    JSON.parse(JSON.stringify(view.requestedSchema)) as unknown,
  );
}

describe("InteractionBroker", () => {
  it("opens and resolves a normal tool approval", async () => {
    const { broker, journal } = createBroker();
    const pendingCount = vi.fn();
    broker.subscribe(sessionId, pendingCount);
    const controller = new AbortController();

    const result = broker.canUseTool(() => sessionId)(
      "Bash",
      { command: "npm test" },
      toolOptions(controller.signal),
    );

    expect(broker.pending(sessionId)).toEqual([
      expect.objectContaining({
        id: interactionId,
        sessionId,
        kind: "tool-approval",
        toolName: "Bash",
        status: "pending",
      }),
    ]);
    broker.respond(interactionId, {
      kind: "allow",
      suggestionIndexes: [],
    });

    await expect(result).resolves.toEqual({ behavior: "allow" });
    expect(pendingCount).toHaveBeenLastCalledWith(0);
    expect(
      journal.replay({ epoch: "epoch-a", after: 0 }),
    ).toMatchObject({
      kind: "events",
      events: [
        { type: "interaction.opened" },
        {
          type: "interaction.resolved",
          payload: { interactionId, status: "resolved", decision: "allow" },
        },
      ],
    });
  });

  it("returns only indexed permission suggestions retained by the server", async () => {
    const { broker } = createBroker();
    const suggestion: PermissionUpdate = {
      type: "setMode",
      mode: "acceptEdits",
      destination: "session",
    };
    const result = broker.canUseTool(() => sessionId)(
      "Edit",
      { file_path: "/repo/index.ts" },
      toolOptions(new AbortController().signal, [suggestion]),
    );

    expect(broker.pending(sessionId)[0]).toMatchObject({
      permissionSuggestions: [{ index: 0 }],
    });
    broker.respond(interactionId, {
      kind: "allow",
      suggestionIndexes: [0],
    });

    await expect(result).resolves.toEqual({
      behavior: "allow",
      updatedPermissions: [suggestion],
    });
  });

  it("maps AskUserQuestion answers into updated tool input", async () => {
    const { broker } = createBroker();
    const input = {
      questions: [
        {
          header: "Environment",
          question: "Which environment?",
          options: [{ label: "Staging" }, { label: "Production" }],
          multiSelect: false,
        },
      ],
    };
    const result = broker.canUseTool(() => sessionId)(
      "AskUserQuestion",
      input,
      toolOptions(new AbortController().signal),
    );

    expect(broker.pending(sessionId)[0]).toMatchObject({
      kind: "question",
      questions: input.questions,
    });
    broker.respond(interactionId, {
      kind: "answer",
      answers: { "Which environment?": "Staging" },
    });

    await expect(result).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { "Which environment?": "Staging" },
      },
    });
  });

  it.each(["accept", "decline", "cancel"] as const)(
    "maps MCP elicitation action %s",
    async (action) => {
      const { broker } = createBroker();
      const result = broker.onElicitation(() => sessionId)(
        {
          serverName: "showcase",
          message: "Confirm",
          mode: "form",
          requestedSchema: action === "accept"
            ? {
                type: "object",
                properties: { confirmed: { type: "boolean" } },
              }
            : {
                type: "object",
                properties: {
                  nested: { type: "array", items: { type: "string" } },
                },
              },
        },
        { signal: new AbortController().signal },
      );

      expect(broker.pending(sessionId)[0]).toMatchObject({
        kind: "mcp-elicitation",
        serverName: "showcase",
      });
      broker.respond(interactionId, {
        kind: "elicit",
        action,
        ...(action === "accept"
          ? { content: { confirmed: true } }
          : { content: { ignored: { nested: true } } }),
      });

      await expect(result).resolves.toEqual({
        action,
        ...(action === "accept" ? { content: { confirmed: true } } : {}),
      });
    },
  );

  it("keeps MCP elicitation pending after invalid content and accepts a valid retry", async () => {
    const { broker } = createBroker();
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          required: ["confirmed", "mode"],
          properties: {
            confirmed: { type: "boolean", title: "确认" },
            mode: {
              type: "string",
              title: "模式",
              enum: ["focused", "broad"],
            },
          },
        },
      },
      { signal: new AbortController().signal },
    );
    for (const content of [
      { confirmed: "true", mode: "focused" },
      { mode: "focused" },
      { confirmed: true, mode: "wide" },
      { confirmed: true, mode: "focused", extra: true },
    ]) {
      expect(() => broker.respond(interactionId, {
        kind: "elicit",
        action: "accept",
        content,
      })).toThrow(expect.objectContaining({
        code: "INTERACTION_RESPONSE_INVALID",
      }));
      expect(broker.pending(sessionId)).toHaveLength(1);
    }

    broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: { confirmed: true, mode: "focused" },
    });
    await expect(result).resolves.toEqual({
      action: "accept",
      content: { confirmed: true, mode: "focused" },
    });
  });

  it("keeps MCP elicitation pending when a response has a hidden extra key", async () => {
    const { broker } = createBroker();
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          required: ["confirmed"],
          properties: { confirmed: { type: "boolean" } },
        },
      },
      { signal: new AbortController().signal },
    );
    const content = { confirmed: true } as Record<string, unknown>;
    Object.defineProperty(content, "hidden", {
      configurable: true,
      value: true,
    });

    expect(() => broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content,
    })).toThrow(expect.objectContaining({
      code: "INTERACTION_RESPONSE_INVALID",
    }));
    expect(broker.pending(sessionId)).toHaveLength(1);

    broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: { confirmed: true },
    });
    await expect(result).resolves.toEqual({
      action: "accept",
      content: { confirmed: true },
    });
  });

  it("rejects a non-enumerable unsupported schema keyword before resolving", async () => {
    const { broker } = createBroker();
    const field = { type: "string" } as Record<string, unknown>;
    Object.defineProperty(field, "pattern", {
      configurable: true,
      value: ".*",
    });
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          properties: { value: field },
        },
      },
      { signal: new AbortController().signal },
    );

    const view = broker.pending(sessionId)[0];
    expect(view?.kind).toBe("mcp-elicitation");
    if (view?.kind !== "mcp-elicitation") {
      throw new Error("Expected MCP elicitation");
    }
    expect(parseBrowserSchema(view)).toMatchObject({
      supported: false,
      reason: "MCP 表单 schema 不受支持。",
    });

    expect(() => broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: { value: "anything" },
    })).toThrow(expect.objectContaining({
      code: "INTERACTION_RESPONSE_INVALID",
    }));
    expect(broker.pending(sessionId)).toHaveLength(1);

    broker.respond(interactionId, {
      kind: "elicit",
      action: "cancel",
    });
    await expect(result).resolves.toEqual({ action: "cancel" });
  });

  it("enforces non-enumerable required property definitions", async () => {
    const { broker } = createBroker();
    const properties = {} as Record<string, unknown>;
    Object.defineProperty(properties, "confirmed", {
      configurable: true,
      value: { type: "boolean", title: "确认" },
    });
    const requestedSchema = {
      type: "object",
      properties,
    } as Record<string, unknown>;
    Object.defineProperty(requestedSchema, "required", {
      configurable: true,
      value: ["confirmed"],
    });
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema,
      },
      { signal: new AbortController().signal },
    );

    const view = broker.pending(sessionId)[0];
    expect(view?.kind).toBe("mcp-elicitation");
    if (view?.kind !== "mcp-elicitation") {
      throw new Error("Expected MCP elicitation");
    }
    expect(parseBrowserSchema(view)).toMatchObject({
      supported: true,
      fields: [{ name: "confirmed", required: true }],
    });

    expect(() => broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: {},
    })).toThrow(expect.objectContaining({
      code: "INTERACTION_RESPONSE_INVALID",
    }));
    expect(broker.pending(sessionId)).toHaveLength(1);

    broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: { confirmed: true },
    });
    await expect(result).resolves.toEqual({
      action: "accept",
      content: { confirmed: true },
    });
  });

  it("projects accessor and symbol schemas as unsupported without evaluating them", async () => {
    for (const unsafeKind of ["accessor", "symbol"] as const) {
      const { broker } = createBroker();
      let getterCalls = 0;
      const requestedSchema = {
        type: "object",
        properties: {},
      } as Record<string | symbol, unknown>;
      if (unsafeKind === "accessor") {
        Object.defineProperty(requestedSchema, "title", {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return "不应读取";
          },
        });
      } else {
        requestedSchema[Symbol("unsupported")] = true;
      }
      const result = broker.onElicitation(() => sessionId)(
        {
          serverName: "showcase",
          message: "Confirm",
          mode: "form",
          requestedSchema,
        },
        { signal: new AbortController().signal },
      );

      const view = broker.pending(sessionId)[0];
      expect(view?.kind).toBe("mcp-elicitation");
      if (view?.kind !== "mcp-elicitation") {
        throw new Error("Expected MCP elicitation");
      }
      expect(parseBrowserSchema(view)).toMatchObject({
        supported: false,
      });
      expect(getterCalls).toBe(0);
      expect(() => broker.respond(interactionId, {
        kind: "elicit",
        action: "accept",
        content: {},
      })).toThrow(expect.objectContaining({
        code: "INTERACTION_RESPONSE_INVALID",
      }));
      expect(broker.pending(sessionId)).toHaveLength(1);

      broker.respond(interactionId, {
        kind: "elicit",
        action: "decline",
      });
      await expect(result).resolves.toEqual({ action: "decline" });
      expect(getterCalls).toBe(0);
    }
  });

  it("publishes no source values for a JSON-safe unsupported schema", async () => {
    const { broker, journal } = createBroker();
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          title: "SECRET_MARKER",
          properties: {
            password: {
              type: "string",
              default: { apiKey: "NESTED_SECRET" },
            },
          },
        },
      },
      { signal: new AbortController().signal },
    );

    const view = broker.pending(sessionId)[0];
    expect(view?.kind).toBe("mcp-elicitation");
    if (view?.kind !== "mcp-elicitation") {
      throw new Error("Expected MCP elicitation");
    }
    expect(parseBrowserSchema(view)).toEqual({
      supported: false,
      reason: "MCP 表单 schema 不受支持。",
    });
    const browserAndEventJson = JSON.stringify({
      pending: broker.pending(sessionId),
      events: journal.replay({ epoch: "epoch-a", after: 0 }),
    });
    expect(browserAndEventJson).not.toContain("SECRET_MARKER");
    expect(browserAndEventJson).not.toContain("NESTED_SECRET");
    expect(browserAndEventJson).not.toContain("password");
    expect(browserAndEventJson).not.toContain("apiKey");
    expect(() => broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: {},
    })).toThrow(expect.objectContaining({
      code: "INTERACTION_RESPONSE_INVALID",
    }));
    expect(broker.pending(sessionId)).toHaveLength(1);

    broker.respond(interactionId, {
      kind: "elicit",
      action: "cancel",
    });
    await expect(result).resolves.toEqual({ action: "cancel" });
  });

  it("opens an unsupported interaction for a 5000-level schema without throwing", async () => {
    const { broker } = createBroker();
    let requestedSchema: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 5_000; depth += 1) {
      requestedSchema = { nested: requestedSchema };
    }
    let result:
      | ReturnType<ReturnType<InteractionBroker["onElicitation"]>>
      | undefined;

    expect(() => {
      result = broker.onElicitation(() => sessionId)(
        {
          serverName: "showcase",
          message: "Confirm",
          mode: "form",
          requestedSchema,
        },
        { signal: new AbortController().signal },
      );
    }).not.toThrow();
    expect(broker.pending(sessionId)).toHaveLength(1);
    const view = broker.pending(sessionId)[0];
    expect(view?.kind).toBe("mcp-elicitation");
    if (view?.kind !== "mcp-elicitation") {
      throw new Error("Expected MCP elicitation");
    }
    expect(parseBrowserSchema(view)).toMatchObject({ supported: false });

    broker.respond(interactionId, {
      kind: "elicit",
      action: "decline",
    });
    await expect(result).resolves.toEqual({ action: "decline" });
  });

  it.each([
    ["ownKeys", () => new Proxy({}, {
      ownKeys: () => {
        throw new Error("OWN_KEYS_TRAP_SECRET");
      },
    })],
    ["getPrototypeOf", () => new Proxy({}, {
      getPrototypeOf: () => {
        throw new Error("PROTOTYPE_TRAP_SECRET");
      },
    })],
    ["getOwnPropertyDescriptor", () => new Proxy(
      { type: "object" },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("DESCRIPTOR_TRAP_SECRET");
        },
      },
    )],
    ["Array.isArray", () => {
      const revocable = Proxy.revocable([], {});
      revocable.revoke();
      return revocable.proxy;
    }],
  ] as const)(
    "opens a fixed unsupported interaction when %s throws",
    async (_label, createSchema) => {
      const { broker, journal } = createBroker();
      let result:
        | ReturnType<ReturnType<InteractionBroker["onElicitation"]>>
        | undefined;

      expect(() => {
        result = broker.onElicitation(() => sessionId)(
          {
            serverName: "showcase",
            message: "Confirm",
            mode: "form",
            requestedSchema: createSchema(),
          },
          { signal: new AbortController().signal },
        );
      }).not.toThrow();
      expect(broker.pending(sessionId)).toHaveLength(1);
      const wire = JSON.stringify({
        pending: broker.pending(sessionId),
        events: journal.replay({ epoch: "epoch-a", after: 0 }),
      });
      expect(wire).not.toContain("TRAP_SECRET");

      broker.respond(interactionId, {
        kind: "elicit",
        action: "cancel",
      });
      await expect(result).resolves.toEqual({ action: "cancel" });
    },
  );

  it("opens a fixed unsupported interaction when final serialization throws", async () => {
    const { broker, journal } = createBroker();
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("SERIALIZE_TRAP_SECRET");
    });
    let result:
      | ReturnType<ReturnType<InteractionBroker["onElicitation"]>>
      | undefined;

    try {
      expect(() => {
        result = broker.onElicitation(() => sessionId)(
          {
            serverName: "showcase",
            message: "Confirm",
            mode: "form",
            requestedSchema: { type: "object", properties: {} },
          },
          { signal: new AbortController().signal },
        );
      }).not.toThrow();
    } finally {
      stringify.mockRestore();
    }
    expect(broker.pending(sessionId)).toHaveLength(1);
    const wire = JSON.stringify({
      pending: broker.pending(sessionId),
      events: journal.replay({ epoch: "epoch-a", after: 0 }),
    });
    expect(wire).not.toContain("SERIALIZE_TRAP_SECRET");

    broker.respond(interactionId, {
      kind: "elicit",
      action: "decline",
    });
    await expect(result).resolves.toEqual({ action: "decline" });
  });

  it("keeps MCP elicitation pending for accessor and symbol response keys", async () => {
    const { broker } = createBroker();
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          required: ["confirmed"],
          properties: { confirmed: { type: "boolean" } },
        },
      },
      { signal: new AbortController().signal },
    );
    const accessorContent = { confirmed: true } as Record<string, unknown>;
    Object.defineProperty(accessorContent, "hidden", {
      get: () => true,
    });
    const symbolContent = {
      confirmed: true,
      [Symbol("hidden")]: true,
    };

    for (const content of [accessorContent, symbolContent]) {
      expect(() => broker.respond(interactionId, {
        kind: "elicit",
        action: "accept",
        content,
      })).toThrow(expect.objectContaining({
        code: "INTERACTION_RESPONSE_INVALID",
      }));
      expect(broker.pending(sessionId)).toHaveLength(1);
    }

    broker.respond(interactionId, {
      kind: "elicit",
      action: "accept",
      content: { confirmed: true },
    });
    await expect(result).resolves.toEqual({
      action: "accept",
      content: { confirmed: true },
    });
  });

  it("rejects pending work on abort and refuses a second response", async () => {
    const { broker } = createBroker();
    const controller = new AbortController();
    const result = broker.canUseTool(() => sessionId)(
      "Read",
      { file_path: "/repo/README.md" },
      toolOptions(controller.signal),
    );

    controller.abort();

    await expect(result).rejects.toMatchObject({
      code: "INTERACTION_ABORTED",
    });
    expect(broker.pending(sessionId)).toEqual([]);
    expect(() =>
      broker.respond(interactionId, {
        kind: "allow",
        suggestionIndexes: [],
      }),
    ).toThrow(expect.objectContaining({ code: "INTERACTION_NOT_PENDING" }));
  });
});
