import { z } from "zod";
import { eventEnvelopeSchema } from "./events.js";
import { appSnapshotSchema } from "./snapshots.js";

export const serverFrameSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("snapshot"),
      snapshot: appSnapshotSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("events"),
      events: z.array(eventEnvelopeSchema),
    })
    .strict(),
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;
