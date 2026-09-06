import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import {
  installAddonAction,
  loadCatalogAction,
  loadMetaDetailsAction,
  loadPlayerAction,
} from '../apps/desktop/src/core/actions.ts';
import { adaptCoreState, addonFromManifest } from '../apps/desktop/src/core/adapters.ts';
import { createAddonNetwork } from '../apps/desktop/src/core/addonNetwork.ts';
import { fixturePreview, fixtureSource, initializeCore } from './test-support/core-stream.mjs';

const stored = process.argv[2] === 'stored';
const storage = new Map(
  stored
    ? [
        ['profile', process.argv[3]],
        ['schema_version', process.argv[4]],
      ]
    : [],
);
const core = await initializeCore({ storage });
const requests = [];
const meta = { id: 'kino-fixture', type: 'movie', name: 'Transport fixture', videos: [] };
const network = createAddonNetwork(async (request) => {
  requests.push(request.url);
  return Response.json({ meta });
}, false);
globalThis.fetch = network.coreFetch;
const addon = addonFromManifest('http://insecure.invalid/synthetic-secret/manifest.json', {
  id: 'synthetic.insecure',
  name: 'Synthetic insecure add-on',
  version: '1.0.0',
  types: ['movie'],
  resources: ['meta', 'stream'],
  catalogs: [],
});
if (!stored) core.dispatch(installAddonAction(addon), undefined, '');
core.dispatch(
  loadPlayerAction({
    meta: { ...fixturePreview, id: meta.id, name: meta.name, type: meta.type },
    metaTransportUrl: addon.transportUrl,
    streamTransportUrl: addon.transportUrl,
    stream: fixtureSource({ url: 'https://media.invalid/fixture.mp4' }),
    video: null,
    nextVideo: null,
  }),
  'player',
  '',
);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(
  requests.filter((url) => url.startsWith('http://insecure.invalid/')).length,
  0,
  'A descriptor supplied directly to Core must not transmit an insecure add-on request.',
);
// An insecure stored descriptor is still a displayable descriptor: it adapts,
// and the transport policy annotates it rather than failing the model.
const described = adaptCoreState('ctx', core.get_state('ctx')).profile.addons.find(
  (item) => item.manifest.id === addon.manifest.id,
);
assert.ok(described, 'A blocked descriptor must stay readable in the profile.');
assert.equal(network.describeAddon(described).transportIssue, 'insecure');
assert.equal(core.get_state('player').metaItem.type, 'Err');
console.log(
  `Core blocked ${stored ? 'stored' : 'directly installed'} insecure descriptors before network transmission.`,
);

let followed = false;
globalThis.fetch = createAddonNetwork(
  async () => ({ type: 'opaqueredirect', status: 0 }),
  false,
  undefined,
  async () => {
    followed = true;
    return { status: 200, body: JSON.stringify({ metas: [meta] }) };
  },
).coreFetch;
core.dispatch(
  loadCatalogAction({
    base: 'https://v3-cinemeta.strem.io/manifest.json',
    path: { resource: 'catalog', type: 'movie', id: 'top', extra: [] },
  }),
  'discover',
  '',
);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(followed, true, 'Core catalog requests must reach the secure redirect transport.');
assert.equal(core.get_state('discover').catalog.content.type, 'Ready');
console.log('Pinned Core loads catalog metadata through the secure redirect transport.');

const localAddon = core
  .get_state('ctx')
  .profile.addons.find((item) => item.manifest.id === 'org.stremio.local');
assert.ok(localAddon, 'Exercise the real built-in Local Files descriptor.');
assert.equal(
  adaptCoreState('ctx', core.get_state('ctx')).profile.addons.some(
    (item) => item.manifest.id === localAddon.manifest.id,
  ),
  false,
);
const supportedAddon = addonFromManifest('https://supported.invalid/manifest.json', {
  id: 'synthetic.supported',
  name: 'Supported streams',
  version: '1.0.0',
  types: ['movie'],
  resources: ['stream'],
  catalogs: [],
});
core.dispatch(installAddonAction(supportedAddon), undefined, '');
const localRequests = [];
const movie = { ...fixturePreview, id: 'tt0000001', type: 'movie' };
globalThis.fetch = createAddonNetwork(async (request) => {
  localRequests.push(request.url);
  return Response.json(
    request.url.includes('/stream/')
      ? { streams: [{ url: 'https://media.invalid/movie.mp4' }] }
      : { meta: { ...movie, videos: [] } },
  );
}, true).coreFetch;
core.dispatch(loadMetaDetailsAction(movie, movie.id), 'meta_details', '');
await new Promise((resolve) => setTimeout(resolve, 30));
const rawDetails = core.get_state('meta_details');
assert.ok(
  rawDetails.streams.some((resource) => resource.addon.manifest.id === localAddon.manifest.id),
);
const details = adaptCoreState('meta_details', rawDetails);
assert.equal(
  details.streams.some((resource) => resource.addon.manifest.id === localAddon.manifest.id),
  false,
);
assert.ok(
  details.streams.some(
    (resource) =>
      resource.addon.manifest.id === supportedAddon.manifest.id &&
      resource.content.type === 'Ready' &&
      resource.content.content.length === 1,
  ),
);
assert.equal(
  localRequests.some((url) => new URL(url).hostname === '127.0.0.1'),
  false,
);
assert.ok(
  core.get_state('ctx').profile.addons.some((item) => item.manifest.id === localAddon.manifest.id),
  'Kino exclusions must not uninstall add-ons from the shared Stremio profile.',
);
console.log(
  'Kino excludes default and stored Local Files without contacting its service or changing the shared profile.',
);
if (!stored) {
  const profile = core.get_state('ctx').profile;
  const result = spawnSync(
    process.execPath,
    [process.argv[1], 'stored', JSON.stringify(profile), storage.get('schema_version')],
    { encoding: 'utf8', timeout: 15000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout + result.stderr).includes('synthetic-secret'),
    false,
    'Blocked configured URLs must not enter Core diagnostics.',
  );
  process.stdout.write(result.stdout);
}
process.exit(0);
