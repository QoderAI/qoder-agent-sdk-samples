import type { WireError } from "../../shared/errors.js";
import type { ServerFrame } from "../../shared/frames.js";
import {
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_COLLAPSED,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from "../features/layout/columns.js";
import type { DetailsSelection } from "../features/layout/details-selection.js";
import { createInitialState, reduceServerFrame } from "./app-reducer.js";
import type {
  AppState,
  ConnectionState,
  SdkConsoleTab,
} from "./app-state.js";
import {
  COMMAND_CORRELATION_LIMIT,
  type CommandOwner,
} from "./command-ownership.js";

/** Small external store used by React and the realtime transport. */
export class AppStore {
  readonly #listeners = new Set<() => void>();
  #state: AppState = createInitialState();

  getState = (): AppState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  applyFrame(frame: ServerFrame): { needsSnapshot: boolean } {
    const reduced = reduceServerFrame(this.#state, frame);
    if (reduced.state !== this.#state) this.#replace(reduced.state);
    return { needsSnapshot: reduced.needsSnapshot };
  }

  setConnectionState(connectionState: ConnectionState): void {
    if (connectionState !== this.#state.connectionState) {
      this.#replace({ ...this.#state, connectionState });
    }
  }

  setProtocolError(protocolError: WireError | null): void {
    this.#replace({ ...this.#state, protocolError });
  }

  selectSession(selectedSessionId: string | null): void {
    const detailsSelection =
      selectedSessionId === this.#state.selectedSessionId
        ? this.#state.detailsSelection
        : null;
    this.#replace({
      ...this.#state,
      selectedSessionId,
      serverEpoch: null,
      cursor: 0,
      detailsSelection,
    });
  }

  toggleSidebar(): void {
    this.#replace({
      ...this.#state,
      sidebarWidth:
        this.#state.sidebarWidth === SIDEBAR_COLLAPSED
          ? SIDEBAR_DEFAULT
          : SIDEBAR_COLLAPSED,
    });
  }

  setSidebarWidth(sidebarWidth: number): void {
    this.#replace({
      ...this.#state,
      sidebarWidth: Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, sidebarWidth)),
    });
  }

  setPreferredDetailsWidth(preferredDetailsWidth: number): void {
    this.#replace({
      ...this.#state,
      preferredDetailsWidth: Math.min(
        DETAILS_MAX,
        Math.max(DETAILS_MIN, preferredDetailsWidth),
      ),
    });
  }

  openDetails(detailsSelection: Exclude<DetailsSelection, null>): void {
    this.#replace({ ...this.#state, detailsSelection });
  }

  closeDetails(): void {
    this.#replace({ ...this.#state, detailsSelection: null });
  }

  openSdkConsole(tab?: SdkConsoleTab): void {
    this.#replace({
      ...this.#state,
      sdkConsoleOpen: true,
      ...(tab === undefined ? {} : { sdkConsoleTab: tab }),
    });
  }

  closeSdkConsole(): void {
    this.#replace({
      ...this.#state,
      sdkConsoleOpen: false,
    });
  }

  setSdkConsoleTab(sdkConsoleTab: SdkConsoleTab): void {
    this.#replace({ ...this.#state, sdkConsoleTab });
  }

  openSettings(): void {
    this.#replace({ ...this.#state, settingsOpen: true });
  }

  closeSettings(): void {
    this.#replace({ ...this.#state, settingsOpen: false });
  }

  registerCommand(commandId: string, owner: CommandOwner): void {
    this.#replace({
      ...this.#state,
      commandOwnerships: [
        ...this.#state.commandOwnerships.filter(
          (entry) => entry.commandId !== commandId,
        ),
        { commandId, owner },
      ].slice(-COMMAND_CORRELATION_LIMIT),
    });
  }

  dismissCommandFailure(commandId: string): void {
    this.#replace({
      ...this.#state,
      commandFailures: this.#state.commandFailures.filter(
        (failure) => failure.commandId !== commandId,
      ),
      commandOwnerships: this.#state.commandOwnerships.filter(
        (entry) => entry.commandId !== commandId,
      ),
    });
  }

  dismissProtocolError(): void {
    this.#replace({
      ...this.#state,
      protocolError: null,
    });
  }

  #replace(state: AppState): void {
    this.#state = state;
    for (const listener of this.#listeners) listener();
  }
}
