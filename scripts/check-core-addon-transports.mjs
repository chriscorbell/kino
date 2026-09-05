import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { installAddonAction, loadPlayerAction } from '../apps/desktop/src/core/actions.ts';
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
