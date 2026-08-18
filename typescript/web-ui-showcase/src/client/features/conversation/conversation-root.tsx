import { useCallback, useEffect, useState } from "react";
import type {
  SelectablePermissionMode,
  SessionStarted,
  StartSessionCommand,
} from "../../../shared/commands.js";
import type { WorkspaceView } from "../../../shared/model.js";
import { copy } from "../../i18n/zh-cn.js";
import { useAppState, useAppStore } from "../../store/store-context.js";
import { findCommandFailure } from "../../store/command-ownership.js";
import { ComposerDrafts } from "./composer-drafts.js";
import { CommandFailureNotice } from "../errors/command-failure-notice.js";
import {
  ConversationPanel,
  type ConversationApi,
} from "./conversation-panel.js";
import { PromptComposer, type ComposerTarget } from "./prompt-composer.js";

type ConversationRootApi = ConversationApi & {
  startSession(input: StartSessionCommand): Promise<SessionStarted>;
  setModel(sessionId: string, model?: string): Promise<{ commandId: string }>;
  setPermissionMode(
    sessionId: string,
    mode: SelectablePermissionMode,
  ): Promise<{ commandId: string }>;
};

export function ConversationRoot(props: {
  api: ConversationRootApi;
  workspaces: WorkspaceView[];
  autoResumingSessionIds: ReadonlySet<string>;
  ensureFailedSessionIds: ReadonlySet<string>;
  onAccepted: (label: string, command: { commandId: string }) => void;
  realtime: { selectSession(sessionId: string | null): void };
}): JSX.Element {
  const state = useAppState();
  const store = useAppStore();
  const [drafts] = useState(() => new ComposerDrafts());
  useEffect(() => {
    drafts.retain(["home", ...state.sessionIds]);
  }, [drafts, state.sessionIds]);
  const sessionId = state.selectedSessionId;
  const session = sessionId === null ? undefined : state.sessions[sessionId];
  const pinnedHomeWorkspace = state.homeWorkspaceId === null
    ? undefined
    : props.workspaces.find(
        (candidate) => candidate.id === state.homeWorkspaceId,
      );
  const workspace = pinnedHomeWorkspace ?? [...props.workspaces].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )[0];
  const sessionAutoResuming =
    session === undefined
      ? false
      : props.autoResumingSessionIds.has(session.id);
  const settling =
    sessionId !== null && (session === undefined || sessionAutoResuming);
  const modelFailure = session === undefined
    ? undefined
    : findCommandFailure(state, {
        surface: "runtime",
        control: "model",
        sessionId: session.id,
      });
  const permissionFailure = session === undefined
    ? undefined
    : findCommandFailure(state, {
        surface: "runtime",
        control: "permission",
        sessionId: session.id,
      });
  const availabilityMessage =
    session?.phase === "restorable"
      ? props.ensureFailedSessionIds.has(session.id)
        ? copy.session.ensureFailed
        : session.failure?.message
      : undefined;
  const phase =
    sessionId === null
      ? "hero"
      : session === undefined || sessionAutoResuming
        ? "settling"
        : availabilityMessage !== undefined
          ? "unavailable"
          : "active";
  const queued =
    session === undefined
      ? []
      : state.queuedInputIds.flatMap((id) => {
          const item = state.queuedInputs[id];
          return item?.sessionId === session.id ? [item] : [];
        });
  const searchWorkspaceFiles = useCallback(
    (sessionId: string, query: string) =>
      props.api.searchWorkspaceFiles(sessionId, query),
    [props.api],
  );
  const target: ComposerTarget =
    session === undefined
      ? {
          kind: "home",
          workspaceId: workspace?.id ?? null,
          start: async (text) => {
            const started = await props.api.startSession({
              ...(workspace === undefined ? {} : { workspaceId: workspace.id }),
              text,
            });
            props.realtime.selectSession(started.sessionId);
          },
        }
      : {
          kind: "session",
          session,
          ...(state.runtime[session.id] === undefined
            ? {}
            : { runtime: state.runtime[session.id] }),
          send: async (text) => {
            const accepted = await props.api.sendMessage(session.id, { text });
            store.registerCommand(accepted.commandId, {
              surface: "conversation",
              control: "send",
              sessionId: session.id,
            });
          },
          stop: async () => {
            const accepted = await props.api.interruptSession(session.id);
            store.registerCommand(accepted.commandId, {
              surface: "conversation",
              control: "stop",
              sessionId: session.id,
            });
          },
          setModel: async (model) => {
            const accepted = await props.api.setModel(session.id, model);
            store.registerCommand(accepted.commandId, {
              surface: "runtime",
              control: "model",
              sessionId: session.id,
            });
            return accepted;
          },
          setPermissionMode: async (mode) => {
            const accepted = await props.api.setPermissionMode(session.id, mode);
            store.registerCommand(accepted.commandId, {
              surface: "runtime",
              control: "permission",
              sessionId: session.id,
            });
            return accepted;
          },
          openMcp: () => store.openSdkConsole("mcp"),
          ...(modelFailure === undefined
            ? {}
            : {
                modelFailure: {
                  ...(modelFailure.commandId === undefined
                    ? {}
                    : {
                        commandId: modelFailure.commandId,
                        dismiss: () => {
                          if (modelFailure.commandId !== undefined) {
                            store.dismissCommandFailure(modelFailure.commandId);
                          }
                        },
                      }),
                  message: modelFailure.error.message,
                },
              }),
          ...(permissionFailure === undefined
            ? {}
            : {
                permissionFailure: {
                  ...(permissionFailure.commandId === undefined
                    ? {}
                    : {
                        commandId: permissionFailure.commandId,
                        dismiss: () => {
                          if (permissionFailure.commandId !== undefined) {
                            store.dismissCommandFailure(
                              permissionFailure.commandId,
                            );
                          }
                        },
                      }),
                  message: permissionFailure.error.message,
                },
              }),
          refreshContext: async () => {
            const accepted = await props.api.refreshContext(session.id);
            store.registerCommand(accepted.commandId, {
              surface: "conversation",
              control: "context",
              sessionId: session.id,
            });
            props.onAccepted("Context 刷新请求已接受", accepted);
          },
        };

  return (
    <div className="conversation-body conversation-root" data-phase={phase}>
      {phase === "hero" ? (
        <section className="conversation-phase empty-conversation home-hero">
          <div className="empty-orb">Q</div>
          <h1>{copy.home.title}</h1>
          <p>{copy.home.subtitle}</p>
          <p className="home-workspace">
            {workspace === undefined
              ? copy.home.noWorkspace
              : `${copy.home.recentWorkspace}：${workspace.displayName}`}
          </p>
        </section>
      ) : phase === "settling" ? (
        <section className="conversation-phase empty-conversation" role="status">
          <p>{copy.composer.restoringPlaceholder}</p>
        </section>
      ) : phase === "unavailable" ? (
        <section className="conversation-phase empty-conversation" role="alert">
          <p>{availabilityMessage ?? copy.common.unavailable}</p>
        </section>
      ) : (
        <ConversationPanel api={props.api} />
      )}
      {session === undefined ? null : (
        <CommandFailureNotice owner={([
          "send",
          "stop",
          "cancel",
          "context",
        ] as const).map((control) => ({
          surface: "conversation" as const,
          control,
          sessionId: session.id,
        }))} />
      )}
      <PromptComposer
        target={target}
        drafts={drafts}
        autoResuming={settling}
        {...(availabilityMessage === undefined
          ? {}
          : { disabledReason: availabilityMessage })}
        queued={queued}
        {...(session === undefined
          ? {}
          : {
              cancel: async (uuid: string) => {
                const accepted = await props.api.cancelMessage(
                  session.id,
                  uuid,
                );
                store.registerCommand(accepted.commandId, {
                  surface: "conversation",
                  control: "cancel",
                  sessionId: session.id,
                });
                return accepted;
              },
            })}
        searchWorkspaceFiles={searchWorkspaceFiles}
      />
    </div>
  );
}
