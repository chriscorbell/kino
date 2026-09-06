/// <reference lib="webworker" />

import Bridge from '@stremio/stremio-core-web/bridge.js';
import wasmUrl from '@stremio/stremio-core-web/stremio_core_web_bg.wasm?url';
import { adaptContinueWatchingState, adaptCoreState, adaptDiscoverState } from './adapters';
import { createAddonNetwork, type FollowAddonRedirect } from './addonNetwork';
import { CatalogPaging } from './catalogPaging';
import { PendingCoreWork, trackCoreSync } from './pendingWork';
import { isCoreModelName, type CoreAction, type CoreRuntimeEvent } from './types';

interface CoreWorkerScope extends DedicatedWorkerGlobalScope {
  app_version: string;
  decodeStream(stream: string): unknown;
  dispatch(action: unknown, field: unknown, locationHash: string): void | Promise<void>;
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
  // Every read of a Core model goes through an adapter first, here and in the
  // paging helper, so nothing downstream ever sees a raw serializer payload.
  const paging = new CatalogPaging(
    {
      dispatch: core.dispatch,
      getState: () => adaptDiscoverState(core.get_state('discover')),
    },
    () => {
      void bridge.call(['onCoreEvent'], [{ name: 'NewState', args: ['discover'] }]);
    },
  );
  scope.dispatch = (value, field, hash) => {
    const action = value as CoreAction;
    if (field === 'discover') {
      if (
        action.action === 'CatalogWithFilters' &&
        (action.args as { action?: string } | undefined)?.action === 'LoadNextPage'
      ) {
        return paging.loadNext(hash);
      }
      if (action.action === 'Load' || action.action === 'Unload') paging.reset();
    }
    core.dispatch(value, field, hash);
  };
  scope.decodeStream = core.decode_stream;
  scope.encodeStream = core.encode_stream;

  await core.default({ module_or_path: wasmUrl });
  // The packaged WASM file loads first. Every subsequent Core request, including
  // requests from stored and synced descriptors, goes through this policy.
  const network = createAddonNetwork(
    scope.fetch.bind(scope),
    import.meta.env.DEV,
    () => {
      void bridge.call(['onCoreEvent'], [{ name: 'NewState', args: ['ctx'] }]);
    },
    (url) => bridge.call<Awaited<ReturnType<FollowAddonRedirect>>>(['fetchAddonRedirect'], [url]),
  );
  scope.fetch = paging.observeFetch(network.coreFetch);
  scope.getState = (field) => {
    if (!isCoreModelName(field)) throw new Error('Kino does not read that Stremio model.');
    if (field === 'discover') return paging.snapshot(adaptDiscoverState(core.get_state(field)));
    if (field === 'continue_watching_preview')
      return adaptContinueWatchingState(core.get_state(field), core.decode_stream);
    if (field === 'ctx') {
      const context = adaptCoreState(field, core.get_state(field));
      return {
        profile: {
          ...context.profile,
          addons: context.profile.addons.map((addon) => ({
            ...addon,
            transportIssue: network.describeAddon(addon).transportIssue,
          })),
        },
      };
    }
    return adaptCoreState(field, core.get_state(field));
  };
  await core.initialize_runtime((value) => {
    const event = value as CoreRuntimeEvent;
    if (event.name === 'NewState' && event.args.includes('discover')) paging.updated();
    return bridge.call(['onCoreEvent'], [event]);
  });
};
