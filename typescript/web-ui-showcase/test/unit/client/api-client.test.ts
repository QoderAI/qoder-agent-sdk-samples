import { describe, expect, it } from "vitest";
import { ApiClient } from "../../../src/client/transport/api-client.js";

describe("ApiClient fetch invocation", () => {
  it("starts a Session and validates the synchronous result", async () => {
    let requested: string | URL | Request | undefined;
    let init: RequestInit | undefined;
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: (async (input, options) => {
        requested = input;
        init = options;
        return new Response(
          JSON.stringify({
            sessionId: "00000000-0000-4000-8000-000000000901",
            workspaceId: "00000000-0000-4000-8000-000000000902",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const startSession = (
      client as unknown as {
        startSession?: (input: {
          workspaceId?: string;
          text: string;
          model?: string;
          permissionMode?: "default" | "acceptEdits" | "auto";
        }) => Promise<{ sessionId: string; workspaceId: string }>;
      }
    ).startSession;

    expect(typeof startSession).toBe("function");
    if (startSession === undefined) return;
    await expect(
      startSession.call(client, {
        workspaceId: "00000000-0000-4000-8000-000000000902",
        text: "检查这个项目",
      }),
    ).resolves.toEqual({
      sessionId: "00000000-0000-4000-8000-000000000901",
      workspaceId: "00000000-0000-4000-8000-000000000902",
    });
    expect(String(requested)).toBe(
      "http://127.0.0.1:8787/api/sessions/start",
    );
    expect(init).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        workspaceId: "00000000-0000-4000-8000-000000000902",
        text: "检查这个项目",
      }),
    });
  });

  it("rejects an invalid Session start result instead of trusting raw JSON", async () => {
    const client = new ApiClient({
      fetch: (async () =>
        new Response(
          JSON.stringify({
            sessionId: "00000000-0000-4000-8000-000000000901",
            workspaceId: "not-a-workspace-id",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });
    const startSession = (
      client as unknown as {
        startSession?: (input: { text: string }) => Promise<unknown>;
      }
    ).startSession;

    expect(typeof startSession).toBe("function");
    if (startSession === undefined) return;
    await expect(startSession.call(client, { text: "检查这个项目" })).rejects.toThrow();
  });

  it("reads project file suggestions with an encoded query", async () => {
    let requested: string | URL | Request | undefined;
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: (async (input) => {
        requested = input;
        return new Response(
          JSON.stringify({
            items: [{
              path: "docs/my guide.md",
              mention: "docs/my guide.md",
              rootLabel: "sample-repo",
              source: "workspace",
            }],
            truncated: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const searchWorkspaceFiles = (
      client as unknown as {
        searchWorkspaceFiles?: (
          sessionId: string,
          query: string,
        ) => Promise<{
          items: Array<{
            path: string;
            mention: string;
            rootLabel: string;
            source: "workspace" | "allowed";
          }>;
          truncated: boolean;
        }>;
      }
    ).searchWorkspaceFiles;

    expect(typeof searchWorkspaceFiles).toBe("function");
    if (searchWorkspaceFiles === undefined) return;
    await expect(
      searchWorkspaceFiles.call(
        client,
        "00000000-0000-4000-8000-000000000e02",
        "my guide",
      ),
    ).resolves.toEqual({
      items: [{
        path: "docs/my guide.md",
        mention: "docs/my guide.md",
        rootLabel: "sample-repo",
        source: "workspace",
      }],
      truncated: false,
    });
    expect(String(requested)).toBe(
      "http://127.0.0.1:8787/api/sessions/00000000-0000-4000-8000-000000000e02/files?q=my+guide",
    );
  });

  it("does not bind the ApiClient instance as the fetch receiver", async () => {
    let receiver: unknown = "not-called";
    const fetchImplementation = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            commandId: "00000000-0000-4000-8000-000000000e01",
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      );
    } as unknown as typeof fetch;

    await new ApiClient({ fetch: fetchImplementation }).pickWorkspace();

    expect(receiver).toBeUndefined();
  });

  it("reads a Subagent transcript through an encoded Agent Tool id", async () => {
    let requested: string | URL | Request | undefined;
    const client = new ApiClient({
      baseUrl: "http://127.0.0.1:8787",
      fetch: (async (input) => {
        requested = input;
        return new Response(JSON.stringify({ status: "waiting" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    const getSubagentTranscript = (
      client as unknown as {
        getSubagentTranscript?: (
          sessionId: string,
          toolUseId: string,
        ) => Promise<unknown>;
      }
    ).getSubagentTranscript;

    expect(typeof getSubagentTranscript).toBe("function");
    if (getSubagentTranscript === undefined) return;
    await expect(getSubagentTranscript.call(
      client,
      "00000000-0000-4000-8000-000000000e02",
      "agent/tool 1",
    )).resolves.toEqual({ status: "waiting" });
    expect(String(requested)).toBe(
      "http://127.0.0.1:8787/api/sessions/00000000-0000-4000-8000-000000000e02/subagents/by-tool/agent%2Ftool%201",
    );
  });
});
