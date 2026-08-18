import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import { serverFrameSchema, type ServerFrame } from "../../shared/frames.js";
import type { AppSnapshot } from "../../shared/snapshots.js";
import { sessionIdSchema } from "../../shared/ids.js";
import type { EventJournal, ReplayRequest } from "./event-journal.js";

export type RealtimeHubOptions = {
  journal: EventJournal;
  getSnapshot: (sessionId?: string) => AppSnapshot | Promise<AppSnapshot>;
  allowedOrigins: ReadonlySet<string>;
  allowMissingOriginForTests?: boolean;
};

type ParsedReplay =
  | { kind: "snapshot"; sessionId?: string }
  | { kind: "replay"; request: ReplayRequest; sessionId?: string }
  | { kind: "invalid" };

function parseReplayRequest(rawUrl: string | undefined): ParsedReplay {
  const url = new URL(rawUrl ?? "/ws", "http://127.0.0.1");
  const epoch = url.searchParams.get("epoch");
  const after = url.searchParams.get("after");
  const rawSessionId = url.searchParams.get("sessionId");
  const parsedSessionId =
    rawSessionId === null ? undefined : sessionIdSchema.safeParse(rawSessionId);
  if (parsedSessionId !== undefined && !parsedSessionId.success) {
    return { kind: "invalid" };
  }
  const selection =
    parsedSessionId === undefined ? {} : { sessionId: parsedSessionId.data };
  if (epoch === null && after === null) {
    return { kind: "snapshot", ...selection };
  }
  if (epoch === null || after === null || epoch.length === 0) {
    return { kind: "invalid" };
  }
  const cursor = Number(after);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return { kind: "invalid" };
  }
  return {
    kind: "replay",
    request: { epoch, after: cursor },
    ...selection,
  };
}

function sendFrame(socket: WebSocket, frame: ServerFrame): void {
  socket.send(JSON.stringify(serverFrameSchema.parse(frame)));
}

export async function registerRealtimeHub(
  app: FastifyInstance,
  options: RealtimeHubOptions,
): Promise<void> {
  await app.register(websocket);

  app.get(
    "/ws",
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const origin = request.headers.origin;
        const missingOriginAllowed =
          origin === undefined && options.allowMissingOriginForTests === true;
        if (
          !missingOriginAllowed &&
          (typeof origin !== "string" || !options.allowedOrigins.has(origin))
        ) {
          await reply.code(403).send();
          return;
        }
        if (parseReplayRequest(request.raw.url).kind === "invalid") {
          await reply.code(400).send();
        }
      },
    },
    (socket, request) => {
      let ready = false;
      const buffered = [] as ReturnType<EventJournal["publish"]>[];
      const unsubscribe = options.journal.subscribe((event) => {
        if (ready) {
          sendFrame(socket, { kind: "events", events: [event] });
        } else {
          buffered.push(event);
        }
      });
      const release = (): void => {
        unsubscribe();
      };
      socket.once("close", release);
      socket.once("error", release);

      void (async () => {
        const replayRequest = parseReplayRequest(request.raw.url);
        if (replayRequest.kind === "invalid") {
          throw new Error("Invalid realtime query parameters");
        }
        let initialCursor: number;
        if (replayRequest.kind === "replay") {
          const replay = options.journal.replay(replayRequest.request);
          if (replay.kind === "events") {
            sendFrame(socket, replay);
            initialCursor =
              replay.events.at(-1)?.sequence ?? replayRequest.request.after;
          } else {
            const snapshot = await options.getSnapshot(replayRequest.sessionId);
            sendFrame(socket, { kind: "snapshot", snapshot });
            initialCursor = snapshot.cursor;
          }
        } else {
          const snapshot = await options.getSnapshot(replayRequest.sessionId);
          sendFrame(socket, { kind: "snapshot", snapshot });
          initialCursor = snapshot.cursor;
        }

        for (const event of buffered) {
          if (event.sequence > initialCursor) {
            sendFrame(socket, { kind: "events", events: [event] });
          }
        }
        ready = true;
      })().catch(() => {
        release();
        socket.close(1011, "Unable to initialize realtime stream");
      });
    },
  );
}
