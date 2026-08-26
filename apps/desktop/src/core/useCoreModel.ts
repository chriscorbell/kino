import { useEffect, useEffectEvent, useState } from 'react';

import { useCore } from './context';
import type { CoreTransport } from './transport';
import type { CoreAction, CoreModelName, CoreRuntimeEvent } from './types';

interface CoreModelResult<State> {
  error: string | null;
  loading: boolean;
  state: State | null;
}

interface CoreModelSnapshot<State> extends CoreModelResult<State> {
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
): CoreModelResult<State> {
  const { status, transport } = useCore();
  const dispatchLoad = useEffectEvent(async (target: CoreTransport, targetModel: CoreModelName) => {
    if (action) await target.dispatch(action, targetModel);
  });
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

    void (async () => {
      try {
        await dispatchLoad(transport, model);
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
      void transport.dispatch({ action: 'Unload' }, model).catch(() => undefined);
    };
  }, [actionKey, model, status, transport]);

  if (status !== 'ready' || !transport) {
    return { error: null, loading: status === 'loading', state: null };
  }
  return result.actionKey === actionKey && result.transport === transport
    ? result
    : { error: null, loading: true, state: null };
}
