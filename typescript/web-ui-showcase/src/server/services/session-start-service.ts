import type {
  SessionStarted,
  StartSessionCommand,
} from "../../shared/commands.js";
import { AppError } from "../errors/app-error.js";
import type { SessionService } from "./session-service.js";
import type { WorkspaceService } from "./workspace-service.js";

/** Starts a live Session after choosing and recording its Workspace. */
export class SessionStartService {
  readonly #workspaces: WorkspaceService;
  readonly #sessions: SessionService;

  constructor(options: {
    workspaces: WorkspaceService;
    sessions: SessionService;
  }) {
    this.#workspaces = options.workspaces;
    this.#sessions = options.sessions;
  }

  async start(input: StartSessionCommand): Promise<SessionStarted> {
    const workspace =
      input.workspaceId === undefined
        ? await this.#workspaces.pickAndRegister()
        : await this.#workspaces.require(input.workspaceId);
    if (workspace === null) {
      throw new AppError({
        code: "WORKSPACE_SELECTION_CANCELLED",
        message: "未选择 Workspace，消息尚未发送。",
        status: 409,
        retryable: true,
      });
    }
    const recent = await this.#workspaces.touch(workspace.id);
    const sessionId = await this.#sessions.createWithInitialMessage(
      recent.id,
      input,
      {
        text: input.text,
        priority: "next",
        shouldQuery: true,
      },
    );
    return { sessionId, workspaceId: recent.id };
  }
}
