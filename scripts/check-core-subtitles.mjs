import assert from 'node:assert/strict';

import { installAddonAction, playerAction } from '../apps/desktop/src/core/actions.ts';
import { videoParams } from '../apps/desktop/src/player/videoParams.ts';
import { initializeCore, resolveCoreStream } from './test-support/core-stream.mjs';

const core = await initializeCore();
const addon = {
  transportUrl: 'https://subtitles.invalid/manifest.json',
  flags: {},
  manifest: {
    id: 'synthetic.subtitles',
    name: 'Subtitle fixture',
    version: '1.0.0',
    types: ['movie'],
    resources: ['subtitles'],
    catalogs: [],
  },
};
core.dispatch(installAddonAction(addon), undefined, '');
const requests = [];
const metadataFetch = globalThis.fetch;
globalThis.fetch = async (request) => {
  const url = new URL(request.url);
  if (!url.pathname.includes('/subtitles/')) return metadataFetch(request);
  requests.push(url);
  return Response.json({
    subtitles: [{ id: 'fixture-en', lang: 'eng', url: 'https://subtitles.invalid/english.srt' }],
  });
};

for (const behaviorHints of [
  undefined,
  {
    videoHash: '0123456789abcdef',
    videoSize: 123456,
    filename: 'fixture.mkv',
  },
]) {
  core.dispatch({ action: 'Unload' }, 'player', '');
  requests.length = 0;
  const stream = {
    url: 'https://media.invalid/fixture.mp4',
    ...(behaviorHints ? { behaviorHints } : {}),
  };
  await resolveCoreStream(core, stream);
  await new Promise((resolve) => setImmediate(resolve));
  if (!behaviorHints) {
    assert.equal(
      requests.length,
      0,
      'Core defers hint-free subtitle discovery until media is ready.',
    );
    assert.deepEqual(core.get_state('player').subtitles, []);
  }
  core.dispatch(
    playerAction('VideoParamsChanged', { videoParams: videoParams(stream) }),
    'player',
    '',
  );
  await new Promise((resolve) => setImmediate(resolve));
  const addonRequests = requests.filter((url) => url.hostname === 'subtitles.invalid');
  assert.equal(
    addonRequests.length,
    1,
    'Readiness must discover subtitles without duplicating a hinted request.',
  );
  assert.ok(
    core
      .get_state('player')
      .subtitles.some((subtitle) => subtitle.url === 'https://subtitles.invalid/english.srt'),
  );
  if (behaviorHints) {
    const path = decodeURIComponent(addonRequests[0].pathname);
    for (const [key, value] of Object.entries(behaviorHints))
      assert.ok(path.includes(`${key}=${value}`), path);
  }
  console.log(
    `Pinned Core exposes add-on subtitles for a direct URL ${behaviorHints ? 'with file hints' : 'without file hints'} after media readiness.`,
  );
}
assert.deepEqual(
  videoParams({ behaviorHints: { videoHash: 'not-a-video-hash', videoSize: -1, filename: ' ' } }),
  { hash: null, size: null, filename: null },
);
process.exit(0);
