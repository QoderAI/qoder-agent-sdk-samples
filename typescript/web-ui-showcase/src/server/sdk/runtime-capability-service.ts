import type { RuntimeCapabilityId } from "../../shared/errors.js";
import type { SelectablePermissionMode } from "../../shared/permissions.js";
import {
  commandViewSchema,
  type CommandView,
  type SessionRuntimeView,
} from "../../shared/model.js";
import { AppError } from "../errors/app-error.js";
import type { DirectoryPicker } from "../platform/directory-picker.js";
import { validateWorkspacePath } from "../platform/path-policy.js";
import type { EventJournal } from "../realtime/event-journal.js";
import type { SessionRuntimePatch } from "./session-runtime-state.js";
import type { SessionRuntimeState } from "./session-runtime-state.js";
import type { McpService } from "./mcp-service.js";
import type { QueryPort } from "./query-port.js";
import type { SessionRegistry } from "./session-registry.js";
import { redactForBrowser } from "./redact.js";
import {
  projectBrowserRecord,
  projectBrowserRecords,
} from "./browser-projection.js";

function commandViews(values: readonly unknown[]): CommandView[] {
  return values.map((value) => {
    const safe = projectBrowserRecord(value);
    return commandViewSchema.parse({
      name: safe.name,
      description: safe.description ?? "",
      argumentHint: safe.argumentHint ?? "",
    });
  });
}

function unavailable(
  capability: RuntimeCapabilityId,
  label: string = capability,
) {
  return {
    code: "SDK_CAPABILITY_UNAVAILABLE",
    message: `The ${label} SDK capability could not be refreshed.`,
    retryable: false,
    details: {
      provenance: "runtime-refresh",
      capability,
    },
  };
}

/** Exposes browser-safe controls and runtime data for a live Query. */
export class RuntimeCapabilityService {
  readonly #journal: EventJournal;
  readonly #registry: SessionRegistry;
  readonly #runtimeState: SessionRuntimeState;
  readonly #mcp: McpService;
  readonly #refreshGenerations = new Map<string, number>();
  readonly #modelGenerations = new Map<string, number>();
  readonly #permissionGenerations = new Map<string, number>();
  readonly #includeRawEvents: boolean;
  readonly #picker: DirectoryPicker;
  readonly #refreshSessionMetadata: (
    sessionId: string,
    title?: string,
  ) => Promise<void>;

  constructor(options: {
    journal: EventJournal;
    registry: SessionRegistry;
    runtimeState: SessionRuntimeState;
    mcp: McpService;
    picker: DirectoryPicker;
    refreshSessionMetadata: (
      sessionId: string,
      title?: string,
    ) => Promise<void>;
    includeRawEvents?: boolean;
  }) {
    this.#journal = options.journal;
    this.#registry = options.registry;
    this.#runtimeState = options.runtimeState;
    this.#mcp = options.mcp;
    this.#picker = options.picker;
    this.#refreshSessionMetadata = options.refreshSessionMetadata;
    this.#includeRawEvents = options.includeRawEvents ?? true;
  }

  requireLive(sessionId: string): QueryPort {
    return this.#requireController(sessionId).query();
  }

  async refresh(sessionId: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, () =>
      this.#refreshUnlocked(sessionId));
  }

  async #refreshUnlocked(sessionId: string): Promise<void> {
    const generation = (this.#refreshGenerations.get(sessionId) ?? 0) + 1;
    this.#refreshGenerations.set(sessionId, generation);
    const controller = this.#requireController(sessionId);
    const query = controller.query();
    const [
      initialization,
      models,
      commands,
      agents,
      plugins,
      account,
      context,
      usage,
      mcp,
    ] = await Promise.allSettled([
      query.initializationResult(),
      query.getAvailableModels({ fetchStrategy: "live" }),
      query.supportedCommands(),
      query.supportedAgents(),
      query.listPlugins(),
      query.accountInfo(),
      controller.refreshContext({ required: true }),
      query.getUsageInfo(),
      this.#mcp.preflight(sessionId, query, {
        shouldCommit: () =>
          this.#refreshGenerations.get(sessionId) === generation,
      }),
    ] as const);
    if (this.#refreshGenerations.get(sessionId) !== generation) return;
    const patch: SessionRuntimePatch = {};
    const errors: SessionRuntimeView["errors"] = [];

    if (initialization.status === "fulfilled") {
      patch.capabilities = [...(initialization.value.capabilities ?? [])];
      patch.skills = initialization.value.skills?.map((skill) => skill.name) ?? [];
    } else errors.push(unavailable("initialization"));
    if (models.status === "fulfilled") {
      patch.models = projectBrowserRecords(models.value);
    }
    else errors.push(unavailable("models"));
    if (commands.status === "fulfilled") {
      patch.commands = commandViews(commands.value);
    }
    else errors.push(unavailable("commands"));
    if (agents.status === "fulfilled") {
      patch.agents = projectBrowserRecords(agents.value);
    }
    else errors.push(unavailable("agents"));
    if (plugins.status === "fulfilled") {
      patch.plugins = projectBrowserRecords(plugins.value);
    }
    else errors.push(unavailable("plugins"));
    if (account.status === "fulfilled") {
      patch.account = projectBrowserRecord(account.value);
    }
    else errors.push(unavailable("account"));
    if (context.status === "rejected") errors.push(unavailable("context"));
    if (usage.status === "fulfilled") {
      patch.credits =
        usage.value === null ? null : projectBrowserRecord(usage.value);
    } else errors.push(unavailable("credits"));
    if (mcp.status === "rejected") errors.push(unavailable("mcp", "MCP status"));
    this.#runtimeState.replaceCapabilityErrors(sessionId, {
      ...patch,
      errors,
    });
  }

  async setModel(sessionId: string, model?: string): Promise<void> {
    const generation = (this.#modelGenerations.get(sessionId) ?? 0) + 1;
    this.#modelGenerations.set(sessionId, generation);
    await this.#registry.runGuarded(sessionId, async () => {
      await this.requireLive(sessionId).setModel(model);
      if (this.#modelGenerations.get(sessionId) !== generation) return;
      this.#runtimeState.merge(sessionId, {
        currentModel: model ?? null,
      });
    });
  }

  async refreshContext(sessionId: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      await this.#requireController(sessionId).refreshContext({ required: true });
    });
  }

  async setPermissionMode(
    sessionId: string,
    mode: SelectablePermissionMode,
  ): Promise<void> {
    const generation = (this.#permissionGenerations.get(sessionId) ?? 0) + 1;
    this.#permissionGenerations.set(sessionId, generation);
    await this.#registry.runGuarded(sessionId, async () => {
      await this.requireLive(sessionId).setPermissionMode(mode);
      if (this.#permissionGenerations.get(sessionId) !== generation) return;
      this.#runtimeState.merge(sessionId, {
        currentPermissionMode: mode,
      });
    });
  }

  async addDirectories(
    sessionId: string,
    directories: string[],
  ): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      const canonical: string[] = [];
      for (const directory of directories) {
        canonical.push(await validateWorkspacePath(directory));
      }
      const result = await this.requireLive(sessionId).addDirectories(canonical);
      const current = this.#runtimeState.snapshot(sessionId);
      const accepted = new Set(result.added);
      this.#runtimeState.merge(sessionId, {
        allowedDirectories: [
          ...new Set([
            ...(current.allowedDirectories ?? []),
            ...canonical.filter((directory) => accepted.has(directory)),
          ]),
        ],
        ...(this.#includeRawEvents
          ? {
              rawEvents: [
                {
                  event: "directories.added",
                  result: redactForBrowser(result),
                  occurredAt: new Date().toISOString(),
                },
              ],
            }
          : {}),
      });
    });
  }

  async pickAndAddDirectory(sessionId: string): Promise<void> {
    const picked = await this.#picker.pick();
    if (picked === null) {
      return;
    }
    await this.addDirectories(sessionId, [picked]);
  }

  async stopTask(sessionId: string, taskId: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      await this.requireLive(sessionId).stopTask(taskId);
      this.#journal.publish(
        {
          type: "task.upserted",
          payload: {
            sessionId,
            taskId,
            name: `Task ${taskId}`,
            status: "stopped",
            foreground: false,
            completedAt: new Date().toISOString(),
          },
        },
        { sessionId },
      );
    });
  }

  async backgroundTasks(
    sessionId: string,
    toolUseId?: string,
  ): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      const backgrounded = await this.requireLive(sessionId).backgroundTasks(
        toolUseId,
      );
      if (!backgrounded) {
        throw new AppError({
          code: "TASK_NOT_BACKGROUNDABLE",
          message: "No matching foreground task could be backgrounded.",
          status: 409,
          retryable: false,
        });
      }
    });
  }

  async reloadPlugins(sessionId: string): Promise<void> {
    await this.#registry.runGuarded(sessionId, async () => {
      const query = this.requireLive(sessionId);
      await query.reloadPlugins();
      this.#runtimeState.merge(sessionId, {
        plugins: projectBrowserRecords(await query.listPlugins()),
      });
    });
  }

  async generateTitle(
    sessionId: string,
    description: string,
  ): Promise<void> {
    const title = await this.#registry.runGuarded(sessionId, () =>
      this.requireLive(sessionId).generateSessionTitle(
        description,
        { persist: true },
      ));
    if (title === null || title.trim().length === 0) {
      throw new AppError({
        code: "TITLE_GENERATION_UNAVAILABLE",
        message: "The SDK did not return a generated Session title.",
        status: 409,
        retryable: false,
      });
    }
    await this.#refreshSessionMetadata(sessionId, title);
  }

  snapshot(sessionId: string): SessionRuntimeView {
    return this.#runtimeState.snapshot(sessionId);
  }

  #requireController(sessionId: string) {
    const controller = this.#registry.get(sessionId);
    if (controller === undefined) {
      throw new AppError({
        code: "SESSION_NOT_LIVE",
        message: "此 Session 当前不可用。请重新选择该 Session 后重试 runtime control。",
        status: 409,
        retryable: true,
      });
    }
    return controller;
  }
}
