/// <reference lib="webworker" />

import Bridge from '@stremio/stremio-core-web/bridge.js';
import wasmUrl from '@stremio/stremio-core-web/stremio_core_web_bg.wasm?url';
import { createAddonNetwork } from './addonNetwork';
import { PendingCoreWork, trackCoreSync } from './pendingWork';
import type { ProfileState } from './types';

interface CoreWorkerScope extends DedicatedWorkerGlobalScope {
  app_version: string;
  decodeStream(stream: string): unknown;
  dispatch(action: unknown, field: unknown, locationHash: string): void;
  document: { baseURI: string };
  encodeStream(stream: unknown): string | null;
  get_location_hash(): Promise<unknown>;
  getState(field: unknown): unknown;
  flush(): Promise<void>;
  init(args: { appVersion: string; shellVersion: string | null }): Promise<void>;
  local_storage_get_item(key: string): Promise<unknown>;
  local_storage_remove_item(key: string): Promise<unknown>;
  local_storage_set_item(key: string, value: string): Promise<unknown>;
  shell_version: string | null;
}

const scope = self as unknown as CoreWorkerScope;
const bridge = new Bridge(scope, scope);
const work = new PendingCoreWork();
scope.flush = () => work.flush();
scope.fetch = trackCoreSync(scope.fetch.bind(scope), work);

scope.init = async ({ appVersion, shellVersion }) => {
  scope.document = { baseURI: scope.location.href };
  scope.app_version = appVersion;
  scope.shell_version = shellVersion;
  scope.get_location_hash = () => bridge.call(['location', 'hash'], []);
  scope.local_storage_get_item = (key) => bridge.call(['localStorage', 'getItem'], [key]);
  scope.local_storage_remove_item = (key) =>
    work.track(bridge.call(['localStorage', 'removeItem'], [key]));
  scope.local_storage_set_item = (key, value) =>
    work.track(bridge.call(['localStorage', 'setItem'], [key, value]));

  const loadedCore = await import('@stremio/stremio-core-web/stremio_core_web.js');
  const core =
    typeof loadedCore.default === 'function'
      ? loadedCore
      : (loadedCore.default as unknown as typeof loadedCore);
  scope.dispatch = core.dispatch;
  scope.decodeStream = core.decode_stream;
  scope.encodeStream = core.encode_stream;

  await core.default({ module_or_path: wasmUrl });
  // The packaged WASM file loads first. Every subsequent Core request, including
  // requests from stored and synced descriptors, goes through this policy.
  const network = createAddonNetwork(scope.fetch.bind(scope), import.meta.env.DEV, () => {
    void bridge.call(['onCoreEvent'], [{ name: 'NewState', args: ['ctx'] }]);
  });
  scope.fetch = network.coreFetch;
  scope.getState = (field) => {
    const state = core.get_state(field);
    if (field === 'ctx') {
      const context = state as ProfileState;
      context.profile.addons = context.profile.addons.map(network.describeAddon);
    }
    return state;
  };
  await core.initialize_runtime((event) => bridge.call(['onCoreEvent'], [event]));
};
