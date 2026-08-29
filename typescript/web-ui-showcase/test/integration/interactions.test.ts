import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/server/app.js";
import { EventJournal } from "../../src/server/realtime/event-journal.js";
import { InteractionBroker } from "../../src/server/sdk/interaction-broker.js";

const sessionId = "00000000-0000-4000-8000-000000000601";
const interactionId = "00000000-0000-4000-8000-000000000602";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("interaction response route", () => {
  it("rejects invalid MCP Accept content without consuming the pending retry", async () => {
    const journal = new EventJournal({
      epoch: "interaction-route",
      capacity: 50,
    });
    const broker = new InteractionBroker({
      journal,
      createUuid: () => interactionId,
    });
    app = await createApp({
      assetRoot: null,
      journal,
      interactionBroker: broker,
    });
    const result = broker.onElicitation(() => sessionId)(
      {
        serverName: "showcase",
        message: "Confirm",
        mode: "form",
        requestedSchema: {
          type: "object",
          required: ["confirmed", "mode"],
          properties: {
            confirmed: { type: "boolean" },
            mode: { type: "string", enum: ["focused", "broad"] },
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
      const invalid = await app.inject({
        method: "POST",
        url: `/api/interactions/${interactionId}/respond`,
        payload: { kind: "elicit", action: "accept", content },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({
        code: "INTERACTION_RESPONSE_INVALID",
      });
      expect(broker.pending(sessionId)).toHaveLength(1);
    }

    const valid = await app.inject({
      method: "POST",
      url: `/api/interactions/${interactionId}/respond`,
      payload: {
        kind: "elicit",
        action: "accept",
        content: { confirmed: true, mode: "focused" },
      },
    });
    expect(valid.statusCode).toBe(202);
    await expect(result).resolves.toEqual({
      action: "accept",
      content: { confirmed: true, mode: "focused" },
    });
  });
});
