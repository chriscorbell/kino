// Checks the production intro client against the live TheIntroDB service, which
// the fixtures in check-intro-community.mjs imitate. Twice the fixtures have
// matched Kino's assumptions rather than the service: the client once read
// confidence fields the service does not send (#28), and then matched runtimes
// to the millisecond when the service groups them by the minute. The TheIntroDB
// workflow runs it.
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

// The client turns every failed request into "no intro", the same answer a changed response shape
// gets, so the requests are recorded here to tell an outage from a mismatch. Neither is retried.
const unanswered = [];
const serviceFetch = globalThis.fetch;
globalThis.fetch = async (...request) => {
  try {
    const response = await serviceFetch(...request);
    if (!response.ok) unanswered.push(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    unanswered.push(error.cause?.code ?? error.name);
    throw error;
  }
};
function requireAnswers(step) {
  if (!unanswered.length) return;
  console.error(
    `TheIntroDB did not answer ${step} (${unanswered.join(', ')}). This is an outage or a rate ` +
      'limit, not a change in the response shape. Run the check again later.',
  );
  process.exit(1);
}
async function lookup(durationMs) {
  const marker = await lookupCommunityIntro({ ...episode, durationMs });
  requireAnswers('the client');
  return marker;
}

// Breaking Bad's pilot has had submissions from several releases for as long as
// the service has listed versions.
const episode = { tmdbId: 1396, season: 1, episode: 1 };
const response = await fetch(
  'https://api.theintrodb.org/v3/media?tmdb_id=1396&season=1&episode=1&list_versions=true',
).catch(() => null);
requireAnswers("the check's own request for the pilot's versions");
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
const found = await lookup(near);
assert.ok(
  found,
  `The service answered every request, yet a runtime 3 s from the ${popular.duration_ms} ms ` +
    'version found no intro, so the client no longer reads what the service sends. Its versions ' +
    `carry ${Object.keys(popular).join(', ')}.`,
);
assert.equal(found.source, 'theintrodb');

// Far from every version, the service would fall back to another release.
const runtimes = versions.map((version) => version.duration_ms).filter((runtime) => runtime > 0);
const far = Math.max(...runtimes) + VERSION_WINDOW_MS + 30_000;
assert.equal(
  await lookup(far),
  null,
  `A runtime ${far} ms, past every version, took another release's intro`,
);

console.log(
  `TheIntroDB: a runtime 3 s from the pilot's ${popular.duration_ms} ms version found the intro at ` +
    `${found.startMs}–${found.endMs} ms, and one ${VERSION_WINDOW_MS / 1000 + 30} s past every version found none.`,
);
