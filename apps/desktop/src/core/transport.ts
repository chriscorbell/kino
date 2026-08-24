import Bridge from '@stremio/stremio-core-web/bridge.js';
import CoreWorker from './core.worker?worker';

import { connectNativeSecureStore, nativeShellPresent } from '../native/player';
import {
  NamespacedStorage,
  SecureProfileStorage,
  type CoreSession,
  type SecureAuthStorage,
} from './storage';
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

function nativeAuthStorage(): SecureAuthStorage {
  let pending = Promise.resolve();
  const store = async () => {
    const secureStore = await connectNativeSecureStore();
    if (!secureStore) throw new Error('The macOS secure store is unavailable.');
    return secureStore;
  };
  const enqueue = <Result>(operation: () => Promise<Result>) => {
    const result = pending.then(operation, operation);
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    read: () =>
      enqueue(async () => {
        const secureStore = await store();
        const result = await secureStore.readStremioAuth();
        if (!result.ok) throw new Error('The macOS Keychain could not be read.');
        return result.value || null;
      }),
    remove: () =>
      enqueue(async () => {
        const secureStore = await store();
        if (!(await secureStore.clearStremioAuth())) {
          throw new Error('The Stremio session could not be removed from macOS Keychain.');
        }
      }),
    write: (value) =>
      enqueue(async () => {
        const secureStore = await store();
        if (!(await secureStore.writeStremioAuth(value))) {
          throw new Error('The Stremio session could not be saved to macOS Keychain.');
        }
      }),
  };
}

export async function migrateNativeAccountProfile() {
  if (!nativeShellPresent()) return;
  const local = new NamespacedStorage(window.localStorage, 'account');
  await new SecureProfileStorage(local, nativeAuthStorage()).getItem('profile');
}

export function createCoreTransport(session: CoreSession = 'guest'): CoreTransport {
  const listeners = new Set<CoreEventListener>();
  const worker = new CoreWorker();
  const localStorage = new NamespacedStorage(window.localStorage, session);
  const storage =
    session === 'account' && nativeShellPresent()
      ? new SecureProfileStorage(localStorage, nativeAuthStorage())
      : localStorage;
  const scope = {
    localStorage: storage,
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
