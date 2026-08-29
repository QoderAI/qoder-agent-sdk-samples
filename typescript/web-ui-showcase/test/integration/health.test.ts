import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/server/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health route", () => {
  it("rejects browser API requests from an untrusted Origin", async () => {
    const pick = vi.fn(async () => null);
    app = await createApp({
      assetRoot: null,
      allowedOrigins: new Set(["http://127.0.0.1:5173"]),
      directoryPicker: { pick },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/workspaces/pick",
      headers: { origin: "https://attacker.example" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(pick).not.toHaveBeenCalled();
  });

  it("accepts allowlisted browser Origins and clients without Origin", async () => {
    const allowedOrigin = "http://127.0.0.1:5173";
    app = await createApp({
      assetRoot: null,
      allowedOrigins: new Set([allowedOrigin]),
      directoryPicker: { pick: async () => null },
    });

    const browser = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: allowedOrigin },
    });
    const localClient = await app.inject({ method: "GET", url: "/api/health" });

    expect(browser.statusCode).toBe(200);
    expect(localClient.statusCode).toBe(200);
  });

  it("reports the sample name without starting the SDK", async () => {
    app = await createApp({ assetRoot: null });
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      name: "qoder-agent-sdk-web-ui-showcase",
      status: "ok",
    });
  });
});
