import Bridge from '@stremio/stremio-core-web/bridge.js';
import CoreWorker from './core.worker?worker';

import { connectNativeSecureStore, nativeShellPresent } from '../native/player';
import {
  NamespacedStorage,
  SecureProfileStorage,
  type CoreSession,
  type SecureAuthStorage,
} from './storage';
import type { CoreAction, CoreModelName, CoreRuntimeEvent, CoreStateMap } from './types';

type CoreEventListener = (event: CoreRuntimeEvent) => void;

export interface CoreTransport {
  destroy(): Promise<void>;
  dispatch(action: CoreAction, model?: CoreModelName): Promise<void>;
  flush(): Promise<void>;
  /** The model decides the state; callers cannot ask for a different shape. */
  getState<Model extends CoreModelName>(model: Model): Promise<CoreStateMap[Model]>;
  init(): Promise<void>;
  onBeforeDestroy(callback: () => Promise<void>): () => void;
  prepareClose(): Promise<void>;
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
  const beforeDestroy = new Set<() => Promise<void>>();
  let initializing: Promise<void> | null = null;
  const flush = () => bridge.call<void>(['flush'], []);
  const prepareClose = async () => {
    // Closing while Keychain/WASM startup is still running must also wait for
    // initialization's storage work before terminating the worker.
    await initializing?.catch(() => undefined);
    await Promise.all([...beforeDestroy].map((callback) => callback()));
    await flush();
  };
  let destroying: Promise<void> | null = null;

  return {
    destroy() {
      destroying ??= prepareClose().finally(() => {
        listeners.clear();
        worker.terminate();
      });
      return destroying;
    },
    async dispatch(action, model) {
      await bridge.call(['dispatch'], [action, model, currentHash()]);
    },
    flush,
    // The worker adapts every model before it answers, so the response already
    // has this model's application shape.
    getState<Model extends CoreModelName>(model: Model) {
      return bridge.call<CoreStateMap[Model]>(['getState'], [model]);
    },
    init() {
      initializing ??= bridge.call<void>(['init'], [{ appVersion: '0.0.0', shellVersion: null }]);
      return initializing;
    },
    onBeforeDestroy(callback) {
      beforeDestroy.add(callback);
      return () => beforeDestroy.delete(callback);
    },
    prepareClose,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
