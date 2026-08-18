import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { WorkspaceView } from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";
import type { DirectoryPicker } from "../platform/directory-picker.js";
import { validateWorkspacePath } from "../platform/path-policy.js";
import type {
  StoredWorkspace,
  WorkspaceRepository,
} from "../persistence/workspace-repository.js";
import type { EventJournal } from "../realtime/event-journal.js";

function toView(workspace: StoredWorkspace): WorkspaceView {
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    path: workspace.path,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export class WorkspaceService {
  readonly #repository: WorkspaceRepository;
  readonly #picker: DirectoryPicker;
  readonly #journal: EventJournal;
  readonly #now: () => string;
  readonly #createUuid: () => string;
  readonly #operationTails = new Map<string, Promise<void>>();

  constructor(options: {
    repository: WorkspaceRepository;
    picker: DirectoryPicker;
    journal: EventJournal;
    now?: () => string;
    createUuid?: () => string;
  }) {
    this.#repository = options.repository;
    this.#picker = options.picker;
    this.#journal = options.journal;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createUuid = options.createUuid ?? randomUUID;
  }

  async list(): Promise<WorkspaceView[]> {
    return [...(await this.#repository.list())]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(toView);
  }

  async require(workspaceId: string): Promise<WorkspaceView> {
    const workspace = (await this.#repository.list()).find(
      (candidate) => candidate.id === workspaceId,
    );
    if (workspace === undefined) {
      throw new AppError({
        code: "WORKSPACE_NOT_FOUND",
        message: "The selected Workspace no longer exists.",
        status: 404,
        retryable: false,
      });
    }
    return toView(workspace);
  }

  /** Runs one operation while preventing removal of its Workspace. */
  withWorkspace<T>(
    workspaceId: string,
    operation: (workspace: WorkspaceView) => Promise<T>,
  ): Promise<T> {
    return this.#enqueue(workspaceId, async () =>
      operation(await this.require(workspaceId)));
  }

  async register(path: string, commandId?: string): Promise<WorkspaceView> {
    const canonicalPath = await validateWorkspacePath(path);
    const workspaces = await this.#repository.list();
    const existing = workspaces.find(
      (workspace) => workspace.path === canonicalPath,
    );
    if (existing !== undefined) {
      return this.withWorkspace(existing.id, async (view) => {
        this.#journal.publish(
          { type: "workspace.upserted", payload: view },
          commandId === undefined ? {} : { commandId },
        );
        return view;
      });
    }

    const timestamp = this.#now();
    const workspace: StoredWorkspace = {
      id: this.#createUuid(),
      displayName: basename(canonicalPath) || canonicalPath,
      path: canonicalPath,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.#repository.upsert(workspace);
    const view = toView(workspace);
    this.#journal.publish(
      { type: "workspace.upserted", payload: view },
      commandId === undefined ? {} : { commandId },
    );
    return view;
  }

  async pickAndRegister(commandId?: string): Promise<WorkspaceView | null> {
    const selectedPath = await this.#picker.pick();
    if (selectedPath === null) {
      return null;
    }
    return this.register(selectedPath, commandId);
  }

  async touch(workspaceId: string): Promise<WorkspaceView> {
    return this.withWorkspace(workspaceId, async (workspace) => {
      const touched: StoredWorkspace = {
        ...workspace,
        updatedAt: this.#now(),
      };
      await this.#repository.upsert(touched);
      const view = toView(touched);
      this.#journal.publish({ type: "workspace.upserted", payload: view });
      return view;
    });
  }

  async remove(
    workspaceId: string,
    commandId: string,
    beforeRemove?: (workspace: WorkspaceView) => Promise<void>,
  ): Promise<void> {
    await this.#enqueue(workspaceId, async () => {
      const workspace = await this.require(workspaceId);
      await beforeRemove?.(workspace);
      await this.#repository.remove(workspaceId);
      this.#journal.publish(
        { type: "workspace.removed", payload: { workspaceId } },
        { commandId },
      );
    });
  }

  #enqueue<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTails.get(workspaceId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#operationTails.set(workspaceId, tail);
    void tail.finally(() => {
      if (this.#operationTails.get(workspaceId) === tail) {
        this.#operationTails.delete(workspaceId);
      }
    });
    return result;
  }
}
