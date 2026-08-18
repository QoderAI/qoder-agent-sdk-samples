import { useEffect, useState } from "react";
import { AppShell } from "./features/layout/app-shell.js";
import { AppErrorBoundary } from "./features/errors/app-error-boundary.js";
import { AppStore } from "./store/app-store.js";
import { StoreProvider } from "./store/store-context.js";
import { ApiClient } from "./transport/api-client.js";
import { RealtimeClient } from "./transport/realtime-client.js";

export function App(): JSX.Element {
  const [resources] = useState(() => {
    const store = new AppStore();
    return {
      store,
      api: new ApiClient(),
      realtime: new RealtimeClient({ store }),
    };
  });
  useEffect(() => {
    resources.realtime.start();
    return () => resources.realtime.stop();
  }, [resources]);
  return (
    <StoreProvider store={resources.store}>
      <AppErrorBoundary>
        <AppShell api={resources.api} realtime={resources.realtime} />
      </AppErrorBoundary>
    </StoreProvider>
  );
}
