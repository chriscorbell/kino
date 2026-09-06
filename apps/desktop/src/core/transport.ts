import Bridge from '@stremio/stremio-core-web/bridge.js';
import CoreWorker from './core.worker?worker';
import { t } from '../locales';

import {
  connectNativeSecureStore,
  fetchNativeAddonRedirect,
  nativeShellPresent,
} from '../native/player';
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
    if (!secureStore) throw new Error(t.core.secureStoreUnavailable);
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
        if (!result.ok) throw new Error(t.core.keychainReadFailed);
        return result.value || null;
      }),
    remove: () =>
      enqueue(async () => {
        const secureStore = await store();
        if (!(await secureStore.clearStremioAuth())) {
          throw new Error(t.core.keychainRemoveFailed);
        }
      }),
    write: (value) =>
      enqueue(async () => {
        const secureStore = await store();
        if (!(await secureStore.writeStremioAuth(value))) {
          throw new Error(t.core.keychainSaveFailed);
        }
      }),
  };
}

export async function migrateNativeAccountProfile() {
  if (!nativeShellPresent()) return;
  const local = new NamespacedStorage(window.localStorage, 'account');
  await new SecureProfileStorage(local, nativeAuthStorage()).getItem('profile');
}

export function createCoreTransport(
  session: CoreSession = 'guest',
  onFailure: (error: Error) => void = () => {},
): CoreTransport {
  const listeners = new Set<CoreEventListener>();
  const worker = new CoreWorker();
  const localStorage = new NamespacedStorage(window.localStorage, session);
  const storage =
    session === 'account' && nativeShellPresent()
      ? new SecureProfileStorage(localStorage, nativeAuthStorage())
      : localStorage;
  const scope = {
    fetchAddonRedirect: fetchNativeAddonRedirect,
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
  const pending = new Set<(error: Error) => void>();
  let stopped: Error | null = null;
  const stop = (error: Error, failed = false) => {
    if (stopped) return;
    stopped = error;
    worker.removeEventListener('error', workerFailed);
    worker.removeEventListener('messageerror', workerFailed);
    worker.terminate();
    pending.forEach((reject) => reject(error));
    pending.clear();
    listeners.clear();
    if (failed) onFailure(error);
  };
  const workerFailed = (event: Event) => {
    event.preventDefault();
    stop(new Error(t.core.workerFailed), true);
  };
  worker.addEventListener('error', workerFailed);
  worker.addEventListener('messageerror', workerFailed);
  const call = <Result>(path: string[], args: unknown[]): Promise<Result> => {
    if (stopped) return Promise.reject(stopped);
    return new Promise<Result>((resolve, reject) => {
      const timeout = window.setTimeout(() => stop(new Error(t.core.timeout), true), 20_000);
      const finish = () => {
        window.clearTimeout(timeout);
        pending.delete(cancel);
      };
      const cancel = (error: Error) => {
        finish();
        reject(error);
      };
      pending.add(cancel);
      void bridge.call<Result>(path, args).then(
        (result) => {
          finish();
          resolve(result);
        },
        (error: unknown) => {
          finish();
          reject(error);
        },
      );
    });
  };
  const beforeDestroy = new Set<() => Promise<void>>();
  let initializing: Promise<void> | null = null;
  const flush = () => call<void>(['flush'], []);
  const prepareClose = async () => {
    // Closing while Keychain/WASM startup is still running must also wait for
    // initialization's storage work before terminating the worker.
    await initializing?.catch(() => undefined);
    if (stopped) throw stopped;
    await Promise.all([...beforeDestroy].map((callback) => callback()));
    await flush();
  };
  let destroying: Promise<void> | null = null;

  return {
    destroy() {
      destroying ??= prepareClose().finally(() => {
        stop(new Error(t.core.stopped));
      });
      return destroying;
    },
    async dispatch(action, model) {
      await call(['dispatch'], [action, model, currentHash()]);
    },
    flush,
    // The worker adapts every model before it answers, so the response already
    // has this model's application shape.
    getState<Model extends CoreModelName>(model: Model) {
      return call<CoreStateMap[Model]>(['getState'], [model]);
    },
    init() {
      initializing ??= call<void>(['init'], [{ appVersion: '0.0.0', shellVersion: null }]);
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
