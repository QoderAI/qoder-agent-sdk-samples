import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { z } from "zod";
import { workspaceIdSchema } from "../../shared/ids.js";
import { AppError } from "../errors/app-error.js";

const timestampSchema = z.string().datetime({ offset: true });

const storedWorkspaceSchema = z
  .object({
    id: workspaceIdSchema,
    displayName: z.string().min(1),
    path: z.string().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const workspaceStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    workspaces: z.array(storedWorkspaceSchema),
  })
  .strict();

export type StoredWorkspace = z.infer<typeof storedWorkspaceSchema>;

export interface WorkspaceRepository {
  list(): Promise<StoredWorkspace[]>;
  upsert(workspace: StoredWorkspace): Promise<void>;
  remove(workspaceId: string): Promise<void>;
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

export function createJsonWorkspaceRepository(
  filePath: string,
): WorkspaceRepository {
  let queued: Promise<void> = Promise.resolve();

  async function readStore(): Promise<z.infer<typeof workspaceStoreSchema>> {
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return { schemaVersion: 1, workspaces: [] };
      }
      throw new AppError(
        {
          code: "WORKSPACE_STORE_UNREADABLE",
          message: "Workspace metadata could not be read.",
          status: 500,
          retryable: true,
        },
        { cause: error },
      );
    }
    try {
      return workspaceStoreSchema.parse(JSON.parse(source));
    } catch (error) {
      throw new AppError(
        {
          code: "WORKSPACE_STORE_INVALID",
          message: "Workspace metadata is invalid.",
          status: 500,
          retryable: false,
        },
        { cause: error },
      );
    }
  }

  async function writeStore(
    store: z.infer<typeof workspaceStoreSchema>,
  ): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      dirname(filePath),
      `.${basename(filePath)}.${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, filePath);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch (cleanupError) {
        if (errorCode(cleanupError) !== "ENOENT") {
          throw new AggregateError(
            [error, cleanupError],
            "Workspace metadata write and cleanup both failed",
          );
        }
      }
      throw error;
    }
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queued.then(operation, operation);
    queued = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    list: () =>
      serialize(async () => {
        const store = await readStore();
        return [...store.workspaces];
      }),
    upsert: (workspace) =>
      serialize(async () => {
        const store = await readStore();
        const index = store.workspaces.findIndex(
          (candidate) => candidate.id === workspace.id,
        );
        if (index === -1) {
          store.workspaces.push(workspace);
        } else {
          store.workspaces[index] = workspace;
        }
        await writeStore(store);
      }),
    remove: (workspaceId) =>
      serialize(async () => {
        const store = await readStore();
        store.workspaces = store.workspaces.filter(
          (workspace) => workspace.id !== workspaceId,
        );
        await writeStore(store);
      }),
  };
}
