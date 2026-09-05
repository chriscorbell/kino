import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';

import { useCore } from './context';
import type { CoreTransport } from './transport';
import type { CoreAction, CoreModelName, CoreRuntimeEvent } from './types';

interface CoreModelResult<State> {
  error: string | null;
  loading: boolean;
  state: State | null;
  unload(): Promise<void>;
}

interface CoreModelSnapshot<State> extends Omit<CoreModelResult<State>, 'unload'> {
  actionKey: string | null;
  transport: CoreTransport | null;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  // Stremio Core rejects with plain values; keep them legible in the log.
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    /* fall through to the generic message */
  }
  return 'The Stremio model failed to load.';
}

export function useCoreModel<State>(
  model: CoreModelName,
  action: CoreAction | null,
  actionKey: string,
  options?: { beforeUnload: (transport: CoreTransport, loaded: Promise<void>) => Promise<void> },
): CoreModelResult<State> {
  const { status, transport } = useCore();
  const dispatchLoad = useEffectEvent(async (target: CoreTransport, targetModel: CoreModelName) => {
    if (action) await target.dispatch(action, targetModel);
  });
  const beforeUnload = useEffectEvent(async (target: CoreTransport, loaded: Promise<void>) => {
    await options?.beforeUnload(target, loaded);
  });
  const managedUnload = Boolean(options?.beforeUnload);
  const pendingUnload = useRef(Promise.resolve());
  const release = useRef<() => Promise<void>>(() => Promise.resolve());
  const unload = useCallback(() => release.current(), []);
  const [result, setResult] = useState<CoreModelSnapshot<State>>({
    actionKey: null,
    error: null,
    loading: true,
    state: null,
    transport: null,
  });

  useEffect(() => {
    if (status !== 'ready' || !transport) return;

    let disposed = false;
    const read = async () => {
      try {
        const state = await transport.getState<State>(model);
        if (!disposed) setResult({ actionKey, error: null, loading: false, state, transport });
      } catch (error) {
        console.error(`[kino:core] ${model} state failed`, errorMessage(error));
        if (!disposed)
          setResult({
            actionKey,
            error: errorMessage(error),
            loading: false,
            state: null,
            transport,
          });
      }
    };
    const onEvent = (event: CoreRuntimeEvent) => {
      if (event.name === 'NewState' && event.args.includes(model)) void read();
    };
    const unsubscribe = transport.subscribe(onEvent);
    const loaded = managedUnload
      ? pendingUnload.current.catch(() => undefined).then(() => dispatchLoad(transport, model))
      : dispatchLoad(transport, model);
    let closed: Promise<void> | null = null;
    let unregister = () => {};
    const close = () => {
      if (closed) return closed;
      closed = (async () => {
        if (managedUnload) await beforeUnload(transport, loaded);
        else await loaded.catch(() => undefined);
        disposed = true;
        unsubscribe();
        await transport.dispatch({ action: 'Unload' }, model);
        if (managedUnload) await transport.flush();
        unregister();
      })().catch((error: unknown) => {
        closed = null;
        throw error;
      });
      pendingUnload.current = closed;
      return closed;
    };
    release.current = close;
    if (managedUnload) unregister = transport.onBeforeDestroy(close);

    void (async () => {
      try {
        await loaded;
        await read();
      } catch (error) {
        console.error(`[kino:core] ${model} action failed`, errorMessage(error));
        if (!disposed)
          setResult({
            actionKey,
            error: errorMessage(error),
            loading: false,
            state: null,
            transport,
          });
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      if (managedUnload) {
        void close()
          .catch(() => console.error('[kino:core] player shutdown could not save progress'))
          .finally(unregister);
      } else {
        void transport.dispatch({ action: 'Unload' }, model).catch(() => undefined);
      }
    };
  }, [actionKey, managedUnload, model, status, transport]);

  if (status !== 'ready' || !transport) {
    return { error: null, loading: status === 'loading', state: null, unload };
  }
  if (result.actionKey === actionKey && result.transport === transport)
    return { ...result, unload };
  // A new selection reloads the model. Keeping the previous state while that
  // happens stops the screen collapsing and losing its scroll position; a
  // different transport is a different session, so that state is dropped.
  return {
    error: null,
    loading: true,
    state: result.transport === transport ? result.state : null,
    unload,
  };
}
