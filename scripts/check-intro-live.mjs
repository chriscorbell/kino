// Checks the production intro client against the live TheIntroDB service, which
// the fixtures in check-intro-community.mjs imitate. It needs the network, so it
// runs by hand rather than in CI: run it when the service or the client changes.
// Twice the fixtures have matched Kino's assumptions rather than the service: the
// client once read confidence fields the service does not send (#28), and then
// matched runtimes to the millisecond when the service groups them by the minute.
//
//   pnpm intro:check-live

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { build } = await import(
  pathToFileURL(createRequire(resolve('apps/desktop/package.json')).resolve('vite')).href
);
const output = resolve('build/intro-live');
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: output,
    emptyOutDir: true,
    lib: {
      entry: resolve('apps/desktop/src/intro/markers.ts'),
      formats: ['es'],
      fileName: () => 'markers.js',
    },
  },
});
const { lookupCommunityIntro, VERSION_WINDOW_MS } = await import(
  pathToFileURL(resolve(output, 'markers.js'))
);

// Breaking Bad's pilot has had submissions from several releases for as long as
// the service has listed versions.
const episode = { tmdbId: 1396, season: 1, episode: 1 };
const response = await fetch(
  'https://api.theintrodb.org/v3/media?tmdb_id=1396&season=1&episode=1&list_versions=true',
);
assert.equal(response.status, 200);
const { versions } = await response.json();
assert.ok(Array.isArray(versions) && versions.length > 0, 'The service lists versions');
for (const version of versions)
  assert.ok(
    Number.isSafeInteger(version.duration_ms),
    `A version lists its runtime: ${JSON.stringify(version)}`,
  );
const popular = versions
  .filter((version) => version.duration_ms > 0)
  .toSorted((left, right) => (right.submission_count ?? 0) - (left.submission_count ?? 0))[0];
assert.ok(popular, 'The pilot has a version with a known runtime');

// A real file of that release runs a few seconds from the listed runtime.
const near = popular.duration_ms - 3_000;
const found = await lookupCommunityIntro({ ...episode, durationMs: near });
assert.ok(found, `A runtime 3 s from the ${popular.duration_ms} ms version finds its intro`);
assert.equal(found.source, 'theintrodb');

// Far from every version, the service would fall back to another release.
const runtimes = versions.map((version) => version.duration_ms).filter((runtime) => runtime > 0);
const far = Math.max(...runtimes) + VERSION_WINDOW_MS + 30_000;
assert.equal(await lookupCommunityIntro({ ...episode, durationMs: far }), null);

console.log(
  `TheIntroDB: a runtime 3 s from the pilot's ${popular.duration_ms} ms version found the intro at ` +
    `${found.startMs}–${found.endMs} ms, and one ${VERSION_WINDOW_MS / 1000 + 30} s past every version found none.`,
);
