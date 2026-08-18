import type { AppState, CommandFailureView } from "./app-state.js";

export const COMMAND_CORRELATION_LIMIT = 50;

export type CommandOwner =
  | {
      surface: "runtime";
      control:
        | "model"
        | "permission"
        | "mcp"
        | "directory"
        | "refresh-account"
        | "refresh-extensions"
        | "plugins";
      sessionId: string;
    }
  | {
      surface: "session";
      control:
        | "ensure"
        | "rename"
        | "tag"
        | "fork"
        | "delete"
        | "generate-title";
      sessionId: string;
    }
  | {
      surface: "interaction";
      control: "respond";
      sessionId: string;
      resourceId: string;
    }
  | {
      surface: "task";
      control: "stop" | "background";
      sessionId: string;
      resourceId: string;
    }
  | {
      surface: "conversation";
      control: "send" | "stop" | "cancel" | "context";
      sessionId: string;
    }
  | {
      surface: "workspace";
      control: "pick" | "register";
    };

export type CommandOwnership = {
  commandId: string;
  owner: CommandOwner;
};

function sameOwner(left: CommandOwner, right: CommandOwner): boolean {
  switch (left.surface) {
    case "runtime":
    case "session":
    case "conversation":
      return right.surface === left.surface &&
        right.sessionId === left.sessionId &&
        right.control === left.control;
    case "interaction":
    case "task":
      return right.surface === left.surface &&
        right.sessionId === left.sessionId &&
        right.resourceId === left.resourceId &&
        right.control === left.control;
    case "workspace":
      return right.surface === "workspace" && right.control === left.control;
  }
}

/** Finds the latest safe failure correlated to one of the requested controls. */
export function findCommandFailure(
  state: Pick<AppState, "commandFailures" | "commandOwnerships">,
  owners: CommandOwner | readonly CommandOwner[],
): CommandFailureView | undefined {
  const requested = Array.isArray(owners) ? owners : [owners];
  const commandIds = new Set(
    state.commandOwnerships
      .filter((entry) =>
        requested.some((owner) => sameOwner(entry.owner, owner))
      )
      .map((entry) => entry.commandId),
  );
  return [...state.commandFailures]
    .reverse()
    .find(
      (failure) =>
        failure.commandId !== undefined && commandIds.has(failure.commandId),
    );
}
