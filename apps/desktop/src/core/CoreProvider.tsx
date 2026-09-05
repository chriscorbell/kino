import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { t } from '../locales';
import { connectNativeLifecycle } from '../native/player';

import { ensureGuestCatalog, GuestCatalogError } from './bootstrap';
import { CoreContext, CoreRecoveryContext, type CoreContextValue } from './context';
import { coreFailureDetail, coreFailureMessage } from './errors';
import { loadSession, saveSession, type CoreSession } from './storage';
import { createCoreTransport, type CoreTransport } from './transport';

interface RuntimeState {
  attempt: number;
  error: string | null;
  session: CoreSession | null;
  status: 'error' | 'ready' | 'unavailable';
  transport: CoreTransport | null;
}

const startupFailed = t.core.startupFailed;

export function CoreProvider({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const retryCatalog = useCallback(() => setCatalogAttempt((value) => value + 1), []);
  const [catalog, setCatalog] = useState({
    attempt: -1,
    error: null as string | null,
    transport: null as CoreTransport | null,
  });
  const teardown = useRef(Promise.resolve());
  const activeTransport = useRef<CoreTransport | null>(null);
  const [session, setSession] = useState<CoreSession>(() =>
    typeof window === 'undefined' ? 'guest' : loadSession(window.localStorage),
  );

  useEffect(() => {
    saveSession(window.localStorage, session);
  }, [session]);
  const [runtime, setRuntime] = useState<RuntimeState>({
    attempt: -1,
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
    let transport: CoreTransport | null = null;
    const previousTeardown = teardown.current;
    const fail = (error: unknown) => {
      console.error('[kino:core] initialization failed', coreFailureDetail(error, startupFailed));
      if (!disposed) {
        setRuntime({
          attempt,
          error: coreFailureMessage(error, startupFailed),
          session,
          status: 'error',
          transport: null,
        });
      }
    };
    void previousTeardown
      .then(async () => {
        if (disposed) return;
        transport = createCoreTransport(session, fail);
        activeTransport.current = transport;
        await transport.init();
        // Reading ctx is required; fetching the default catalog is optional.
        await transport.getState('ctx');
        if (!disposed) setRuntime({ attempt, error: null, session, status: 'ready', transport });
      })
      .catch(fail);

    return () => {
      disposed = true;
      teardown.current = previousTeardown
        .then(() => transport?.destroy())
        .catch(() => {
          console.error('[kino:core] session ended before all data could be saved');
        });
    };
  }, [attempt, session]);

  useEffect(() => {
    if (
      runtime.attempt !== attempt ||
      runtime.session !== session ||
      runtime.status !== 'ready' ||
      !runtime.transport ||
      session !== 'guest'
    )
      return;
    const transport = runtime.transport;
    const controller = new AbortController();
    void ensureGuestCatalog(transport, controller.signal).then(
      () => {
        if (!controller.signal.aborted)
          setCatalog({ attempt: catalogAttempt, error: null, transport });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof GuestCatalogError) {
          setCatalog({ attempt: catalogAttempt, error: t.core.catalogFailed, transport });
        } else {
          setRuntime({
            attempt,
            error: coreFailureMessage(error, startupFailed),
            session,
            status: 'error',
            transport: null,
          });
        }
      },
    );
    return () => controller.abort();
  }, [attempt, catalogAttempt, runtime, session]);

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
    if (runtime.session !== session || runtime.attempt !== attempt) {
      return {
        error: null,
        selectSession: setSession,
        session,
        status: 'loading',
        transport: null,
      };
    }
    return { ...runtime, selectSession: setSession, session };
  }, [attempt, runtime, session]);
  const catalogActive = context.status === 'ready' && session === 'guest';
  const catalogCurrent =
    catalog.transport === context.transport && catalog.attempt === catalogAttempt;
  const recovery = useMemo(
    () => ({
      retry,
      retryCatalog,
      catalogLoading: catalogActive && !catalogCurrent,
      catalogError: catalogActive && catalogCurrent ? catalog.error : null,
    }),
    [catalog.error, catalogActive, catalogCurrent, retry, retryCatalog],
  );
  return (
    <CoreContext.Provider value={context}>
      <CoreRecoveryContext.Provider value={recovery}>{children}</CoreRecoveryContext.Provider>
    </CoreContext.Provider>
  );
}
