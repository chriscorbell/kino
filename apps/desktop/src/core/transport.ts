import Bridge from '@stremio/stremio-core-web/bridge.js';
import CoreWorker from './core.worker?worker';

import { NamespacedStorage, type CoreSession } from './storage';
import type { CoreAction, CoreModelName, CoreRuntimeEvent } from './types';

type CoreEventListener = (event: CoreRuntimeEvent) => void;

export interface CoreTransport {
  destroy(): void;
  dispatch(action: CoreAction, model?: CoreModelName): Promise<void>;
  getState<State>(model: CoreModelName): Promise<State>;
  init(): Promise<void>;
  subscribe(listener: CoreEventListener): () => void;
}

function currentHash() {
  return window.location.hash;
}

export function createCoreTransport(session: CoreSession = 'guest'): CoreTransport {
  const listeners = new Set<CoreEventListener>();
  const worker = new CoreWorker();
  const scope = {
    localStorage: new NamespacedStorage(window.localStorage, session),
    location: {
      get hash() {
        return currentHash();
      },
    },
    onCoreEvent(event: CoreRuntimeEvent) {
      listeners.forEach((listener) => listener(event));
    },
  };
  const bridge = new Bridge(scope, worker);

  return {
    destroy() {
      listeners.clear();
      worker.terminate();
    },
    async dispatch(action, model) {
      await bridge.call(['dispatch'], [action, model, currentHash()]);
    },
    getState<State>(model: CoreModelName) {
      return bridge.call<State>(['getState'], [model]);
    },
    async init() {
      await bridge.call(['init'], [{ appVersion: '0.0.0', shellVersion: null }]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
