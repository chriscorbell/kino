import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { connectNativeLifecycle } from '../native/player';

import { ensureGuestCatalog } from './bootstrap';
import { CoreContext, type CoreContextValue } from './context';
import { coreFailureDetail, coreFailureMessage } from './errors';
import { loadSession, saveSession, type CoreSession } from './storage';
import { createCoreTransport, type CoreTransport } from './transport';

interface RuntimeState {
  error: string | null;
  session: CoreSession | null;
  status: 'error' | 'ready' | 'unavailable';
  transport: CoreTransport | null;
}

const startupFailed = 'Stremio Core could not start.';

export function CoreProvider({ children }: { children: ReactNode }) {
  const teardown = useRef(Promise.resolve());
  const activeTransport = useRef<CoreTransport | null>(null);
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
    let disposed = false;
    let disconnect = () => {};
    void connectNativeLifecycle()
      .then((lifecycle) => {
        if (!lifecycle || disposed) return;
        const onClose = (requestId: number) => {
          void (async () => {
            await teardown.current;
            await activeTransport.current?.prepareClose();
            lifecycle.acknowledgeClose(requestId, true);
          })().catch(() => lifecycle.acknowledgeClose(requestId, false));
        };
        lifecycle.closeRequested.connect(onClose);
        lifecycle.setReady(true);
        disconnect = () => {
          lifecycle.setReady(false);
          lifecycle.closeRequested.disconnect(onClose);
        };
      })
      .catch(() => console.error('[kino:shutdown] native close service unavailable'));
    return () => {
      disposed = true;
      disconnect();
    };
  }, []);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;

    let disposed = false;
    const transport = createCoreTransport(session);
    activeTransport.current = transport;
    const previousTeardown = teardown.current;
    void previousTeardown
      .then(async () => {
        if (!disposed) await transport.init();
      })
      .then(async () => {
        if (!disposed && session === 'guest') await ensureGuestCatalog(transport);
      })
      .then(() => {
        if (!disposed) setRuntime({ error: null, session, status: 'ready', transport });
      })
      .catch((error: unknown) => {
        // Guest initialization reads ctx through the adapter, so a contract
        // failure reaches this catch and renders on Home.
        console.error('[kino:core] initialization failed', coreFailureDetail(error, startupFailed));
        if (!disposed) {
          setRuntime({
            error: coreFailureMessage(error, startupFailed),
            session,
            status: 'error',
            transport: null,
          });
        }
      });

    return () => {
      disposed = true;
      teardown.current = previousTeardown
        .then(() => transport.destroy())
        .catch(() => {
          console.error('[kino:core] session ended before all data could be saved');
        });
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
