import { t } from '../locales';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';

import { unloadAction } from './actions';
import { useCore } from './context';
import { coreFailureDetail, coreFailureMessage } from './errors';
import type { FeatureTransport } from './transport';
import type { CoreRuntimeEvent, CoreStateMap, ModelOutsideSession } from './types';
import type { TransientAction } from './writes';

interface CoreModelResult<State> {
  error: string | null;
  loading: boolean;
  state: State | null;
  retry(): void;
}

interface CoreModelSnapshot<State> extends Omit<CoreModelResult<State>, 'retry'> {
  actionKey: string | null;
  revision: number;
  transport: FeatureTransport | null;
}

const modelFailed = t.core.modelFailed;
const failureDetail = (error: unknown) => coreFailureDetail(error, modelFailed);
// A screen renders this string, so a contract failure reads as locale copy
// while the model and field path stay in the log above it.
const failureMessage = (error: unknown) => coreFailureMessage(error, modelFailed);

export function useCoreModel<Model extends ModelOutsideSession>(
  model: Model,
  action: TransientAction | null,
  actionKey: string,
): CoreModelResult<CoreStateMap[Model]> {
  type State = CoreStateMap[Model];
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  const { error: coreError, status, transport } = useCore();
  const dispatchLoad = useEffectEvent(
    async (target: FeatureTransport, targetModel: ModelOutsideSession) => {
      if (action) await target.dispatch(action, targetModel);
    },
  );
  const [result, setResult] = useState<CoreModelSnapshot<State>>({
    actionKey: null,
    revision: -1,
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
        const state = await transport.getState(model);
        if (!disposed)
          setResult({ actionKey, revision, error: null, loading: false, state, transport });
      } catch (error) {
        console.error(`[kino:core] ${model} state failed`, failureDetail(error));
        if (!disposed)
          setResult({
            actionKey,
            revision,
            error: failureMessage(error),
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
        console.error(`[kino:core] ${model} action failed`, failureDetail(error));
        if (!disposed)
          setResult({
            actionKey,
            revision,
            error: failureMessage(error),
            loading: false,
            state: null,
            transport,
          });
      }
    })();

    return () => {
      disposed = true;
      unsubscribe();
      void transport.dispatch(unloadAction, model).catch(() => undefined);
    };
  }, [actionKey, model, revision, status, transport]);

  if (status !== 'ready' || !transport) {
    return { error: coreError, loading: status === 'loading', state: null, retry };
  }
  if (
    result.actionKey === actionKey &&
    result.transport === transport &&
    result.revision === revision
  )
    return { ...result, retry };
  // A new selection reloads the model. Keeping the previous state while that
  // happens stops the screen collapsing and losing its scroll position; a
  // different transport is a different session, so that state is dropped.
  return {
    error: null,
    loading: true,
    state: result.transport === transport ? result.state : null,
    retry,
  };
}
