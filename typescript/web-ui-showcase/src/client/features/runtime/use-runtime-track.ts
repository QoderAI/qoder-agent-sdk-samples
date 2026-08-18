import { useCallback, useState } from "react";
import { copy } from "../../i18n/zh-cn.js";
import type { CommandOwner } from "../../store/command-ownership.js";
import { useAppStore } from "../../store/store-context.js";

type Accepted = { commandId: string };

/** Registers runtime command ownership and surfaces submit failures locally. */
export function useRuntimeTrack(): {
  track: (
    request: Promise<Accepted>,
    control: Extract<CommandOwner, { surface: "runtime" }>["control"],
    sessionId: string,
  ) => Promise<Accepted>;
  submissionError: string | null;
  clearSubmissionError: () => void;
} {
  const store = useAppStore();
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const track = useCallback(
    async (
      request: Promise<Accepted>,
      control: Extract<CommandOwner, { surface: "runtime" }>["control"],
      sessionId: string,
    ): Promise<Accepted> => {
      setSubmissionError(null);
      try {
        const accepted = await request;
        store.registerCommand(accepted.commandId, {
          surface: "runtime",
          control,
          sessionId,
        });
        return accepted;
      } catch (error) {
        setSubmissionError(copy.error.controlSubmitFailed);
        throw error;
      }
    },
    [store],
  );
  return {
    track,
    submissionError,
    clearSubmissionError: () => setSubmissionError(null),
  };
}
