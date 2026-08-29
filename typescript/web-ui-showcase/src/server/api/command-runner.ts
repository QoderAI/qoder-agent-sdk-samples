import { randomUUID } from "node:crypto";
import type { CommandAccepted } from "../../shared/commands.js";
import { commandAcceptedSchema } from "../../shared/commands.js";
import type { EventJournal } from "../realtime/event-journal.js";
import { toWireError } from "../errors/app-error.js";

export class CommandRunner {
  readonly #journal: EventJournal;
  readonly #createUuid: () => string;

  constructor(options: {
    journal: EventJournal;
    createUuid?: () => string;
  }) {
    this.#journal = options.journal;
    this.#createUuid = options.createUuid ?? randomUUID;
  }

  accept(input: {
    sessionId?: string;
    execute: (commandId: string) => Promise<void>;
  }): CommandAccepted {
    const commandId = this.#createUuid();
    const accepted = commandAcceptedSchema.parse({ commandId });
    queueMicrotask(() => {
      void input.execute(commandId).catch((error: unknown) => {
        this.#journal.publish(
          {
            type: "command.failed",
            payload: { error: toWireError(error) },
          },
          {
            commandId,
            ...(input.sessionId === undefined
              ? {}
              : { sessionId: input.sessionId }),
          },
        );
      });
    });
    return accepted;
  }
}
