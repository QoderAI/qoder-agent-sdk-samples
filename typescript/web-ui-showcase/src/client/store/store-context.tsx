import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AppState } from "./app-state.js";
import type { AppStore } from "./app-store.js";

const StoreContext = createContext<AppStore | null>(null);

export function StoreProvider(props: {
  store: AppStore;
  children: ReactNode;
}): JSX.Element {
  return (
    <StoreContext.Provider value={props.store}>
      {props.children}
    </StoreContext.Provider>
  );
}

export function useAppStore(): AppStore {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("StoreProvider is missing");
  return store;
}

export function useAppState(): AppState {
  const store = useAppStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
