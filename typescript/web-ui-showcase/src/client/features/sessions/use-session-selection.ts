import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionView } from "../../../shared/model.js";
import type { CommandFailureView } from "../../store/app-state.js";

type EnsureRequest =
  | { status: "requesting" }
  | { status: "accepted"; commandId: string };

type Accepted = { commandId: string };

/** Owns automatic availability for the currently selected Restorable Session. */
export function useSessionSelection(options: {
  sessions: Record<string, SessionView>;
  commandFailures: CommandFailureView[];
  selectRealtimeSession: (sessionId: string | null) => void;
  ensureSession: (sessionId: string) => Promise<Accepted>;
  registerEnsureCommand: (sessionId: string, commandId: string) => void;
}): {
  selectSession: (sessionId: string | null) => void;
  autoResumingSessionIds: ReadonlySet<string>;
  ensureFailedSessionIds: ReadonlySet<string>;
} {
  const requests = useRef(new Map<string, EnsureRequest>());
  const sessions = useRef(options.sessions);
  const failures = useRef(options.commandFailures);
  sessions.current = options.sessions;
  failures.current = options.commandFailures;
  const [autoResumingSessionIds, setAutoResumingSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [ensureFailedSessionIds, setEnsureFailedSessionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const publishRequests = useCallback(() => {
    setAutoResumingSessionIds(new Set(requests.current.keys()));
  }, []);

  const clearRequest = useCallback(
    (sessionId: string) => {
      if (requests.current.delete(sessionId)) publishRequests();
    },
    [publishRequests],
  );

  useEffect(() => {
    let changed = false;
    for (const [sessionId, request] of requests.current) {
      if (options.sessions[sessionId]?.phase !== "restorable") {
        requests.current.delete(sessionId);
        changed = true;
        continue;
      }
      if (
        request.status === "accepted" &&
        options.commandFailures.some(
          (failure) =>
            failure.sessionId === sessionId &&
            failure.commandId === request.commandId,
        )
      ) {
        requests.current.delete(sessionId);
        changed = true;
      }
    }
    if (changed) publishRequests();
    setEnsureFailedSessionIds((current) => {
      const next = new Set(
        [...current].filter(
          (sessionId) => options.sessions[sessionId]?.phase === "restorable",
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [options.commandFailures, options.sessions, publishRequests]);

  const selectSession = useCallback(
    (sessionId: string | null) => {
      setEnsureFailedSessionIds((current) =>
        current.size === 0 ? current : new Set(),
      );
      let removedOtherRequest = false;
      for (const requestedSessionId of requests.current.keys()) {
        if (requestedSessionId !== sessionId) {
          requests.current.delete(requestedSessionId);
          removedOtherRequest = true;
        }
      }
      if (removedOtherRequest) publishRequests();
      options.selectRealtimeSession(sessionId);
      if (sessionId === null) return;
      if (
        sessions.current[sessionId]?.phase !== "restorable" ||
        requests.current.has(sessionId)
      ) {
        return;
      }

      const request: EnsureRequest = { status: "requesting" };
      requests.current.set(sessionId, request);
      publishRequests();
      void options.ensureSession(sessionId).then(
        ({ commandId }) => {
          if (requests.current.get(sessionId) !== request) return;
          if (sessions.current[sessionId]?.phase !== "restorable") {
            clearRequest(sessionId);
            return;
          }
          options.registerEnsureCommand(sessionId, commandId);
          if (
            failures.current.some(
              (failure) =>
                failure.sessionId === sessionId &&
                failure.commandId === commandId,
            )
          ) {
            clearRequest(sessionId);
            return;
          }
          requests.current.set(sessionId, {
            status: "accepted",
            commandId,
          });
        },
        () => {
          if (requests.current.get(sessionId) !== request) return;
          clearRequest(sessionId);
          setEnsureFailedSessionIds(new Set([sessionId]));
        },
      );
    },
    [
      clearRequest,
      options.ensureSession,
      options.registerEnsureCommand,
      options.selectRealtimeSession,
      publishRequests,
    ],
  );

  return {
    selectSession,
    autoResumingSessionIds,
    ensureFailedSessionIds,
  };
}
