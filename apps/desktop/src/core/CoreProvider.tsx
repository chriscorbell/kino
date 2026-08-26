import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ensureGuestCatalog } from './bootstrap';
import { CoreContext, type CoreContextValue } from './context';
import { loadSession, saveSession, type CoreSession } from './storage';
import { createCoreTransport, type CoreTransport } from './transport';

interface RuntimeState {
  error: string | null;
  session: CoreSession | null;
  status: 'error' | 'ready' | 'unavailable';
  transport: CoreTransport | null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Stremio Core could not start.';
}

export function CoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<CoreSession>(() =>
    typeof window === 'undefined' ? 'guest' : loadSession(window.localStorage),
  );

  useEffect(() => {
    saveSession(window.localStorage, session);
  }, [session]);
  const [runtime, setRuntime] = useState<RuntimeState>({
    error: null,
    session: null,
    status: 'unavailable',
    transport: null,
  });

  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    let disposed = false;
    const transport = createCoreTransport(session);
    void transport
      .init()
      .then(async () => {
        if (session === 'guest') await ensureGuestCatalog(transport);
      })
      .then(() => {
        if (!disposed) setRuntime({ error: null, session, status: 'ready', transport });
      })
      .catch((error: unknown) => {
        console.error('[kino:core] initialization failed', errorMessage(error));
        if (!disposed) {
          setRuntime({ error: errorMessage(error), session, status: 'error', transport: null });
        }
      });

    return () => {
      disposed = true;
      transport.destroy();
    };
  }, [session]);

  const context = useMemo<CoreContextValue>(() => {
    if (typeof Worker === 'undefined') {
      return {
        error: null,
        selectSession: setSession,
        session,
        status: 'unavailable',
        transport: null,
      };
    }
    if (runtime.session !== session) {
      return {
        error: null,
        selectSession: setSession,
        session,
        status: 'loading',
        transport: null,
      };
    }
    return { ...runtime, selectSession: setSession, session };
  }, [runtime, session]);
  return <CoreContext.Provider value={context}>{children}</CoreContext.Provider>;
}
