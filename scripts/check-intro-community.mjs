import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { build } = await import(createRequire(resolve('apps/desktop/package.json')).resolve('vite'));
const output = resolve('build/intro-community');
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
const { lookupCommunityIntro } = await import(pathToFileURL(resolve(output, 'markers.js')));
const identity = { tmdbId: 1396, season: 1, episode: 1, durationMs: 3501000 };
const media = { tmdb_id: 1396, type: 'tv', season: 1, episode: 1 };
const marker = { source: 'theintrodb', startMs: 10000, endMs: 22000 };
const listed = { ...media, versions: [{ duration_ms: 0 }, { duration_ms: identity.durationMs }] };
const selected = { ...media, intro: [{ start_ms: 10000, end_ms: 22000 }] };
const networkFetch = globalThis.fetch;
let bodies = [];
let requests = [];
let hold;
let bodyStarted;
let delayedTimer;
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  requests.push(new URL(request.url, 'http://fixture.invalid').searchParams);
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.cookie, undefined);
  assert.equal(request.headers.referer, undefined);
  const body = bodies.shift();
  if (body === 'held') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{');
    hold = response;
    bodyStarted.resolve();
  } else if (body === 'delayed-list') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.flushHeaders();
    delayedTimer = setTimeout(() => response.end(JSON.stringify(listed)), 2000);
  } else if (body === 'redirect') {
    response.writeHead(302, { Location: '/forbidden' }).end();
  } else {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
  }
});
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  globalThis.fetch = (url, options) => {
    const original = new URL(url);
    assert.equal(original.origin + original.pathname, 'https://api.theintrodb.org/v3/media');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(Object.keys(options.headers), ['Accept']);
    return networkFetch(`http://127.0.0.1:${server.address().port}/${original.search}`, options);
  };
  async function lookup(first = listed, second = selected, input = identity) {
    requests = [];
    bodies = [first, second];
    return lookupCommunityIntro(input);
  }
  assert.deepEqual(await lookup(), marker);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].get('list_versions'), 'true');
  assert.equal(requests[1].get('list_versions'), null);
  assert.equal(requests[1].get('duration_ms'), String(identity.durationMs));
  assert.equal(requests[1].get('merge_unknown'), 'false');
  assert.deepEqual([...requests[1].keys()].sort(), [
    'duration_ms',
    'episode',
    'merge_unknown',
    'season',
    'tmdb_id',
  ]);

  for (const durationMs of [0, 1000000, identity.durationMs + 1, NaN, 1.5]) {
    assert.equal(await lookup(listed, selected, { ...identity, durationMs }), null);
    assert.ok(
      requests.length <= 1,
      'An unmatched runtime never asks the service for fallback markers',
    );
  }
  for (const versions of [
    undefined,
    [{ duration_ms: 0 }],
    [{ duration_ms: '3501000' }],
    [{ duration_ms: identity.durationMs }, { duration_ms: identity.durationMs }],
    Array.from({ length: 513 }, () => ({ duration_ms: 1 })),
  ]) {
    assert.equal(await lookup({ ...media, versions }), null);
    assert.equal(requests.length, 1);
  }
  for (const invalid of [{ tmdb_id: 9 }, { type: 'movie' }, { season: 2 }, { episode: 2 }]) {
    assert.equal(await lookup({ ...listed, ...invalid }), null);
    assert.equal(requests.length, 1);
    assert.equal(await lookup(listed, { ...selected, ...invalid }), null);
  }
  assert.deepEqual(
    await lookup(listed, selected, {
      imdbId: 'tt0903747',
      season: 1,
      episode: 1,
      durationMs: identity.durationMs,
    }),
    marker,
  );
  assert.equal(
    await lookup(
      listed,
      { ...selected, tmdb_id: 9 },
      { imdbId: 'tt0903747', season: 1, episode: 1, durationMs: identity.durationMs },
    ),
    null,
  );
  for (const intro of [
    [{ start_ms: 1, end_ms: null }],
    [{ start_ms: -1, end_ms: 12000 }],
    [{ start_ms: 10000, end_ms: 11000 }],
    [{ start_ms: 0, end_ms: identity.durationMs + 1 }],
  ]) {
    assert.equal(await lookup(listed, { ...media, intro }), null);
  }
  assert.equal(await lookup('not json'), null);
  assert.equal(await lookup('x'.repeat(65537)), null);
  assert.equal(await lookup('redirect'), null);
  assert.equal(requests.length, 1, 'Marker requests do not follow redirects');

  requests = [];
  bodies = [listed, 'held'];
  bodyStarted = Promise.withResolvers();
  const controller = new AbortController();
  const canceled = lookupCommunityIntro(identity, controller.signal);
  const rejection = assert.rejects(canceled, { name: 'AbortError' });
  await bodyStarted.promise;
  controller.abort();
  await rejection;
  hold.end('}');
  requests = [];
  bodies = ['delayed-list', 'held'];
  bodyStarted = Promise.withResolvers();
  const started = Date.now();
  const deadline = lookupCommunityIntro(identity);
  await bodyStarted.promise;
  const bodyClosed = once(hold, 'close');
  assert.equal(await deadline, null);
  assert.equal(requests.length, 2);
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed >= 4500 && elapsed < 6500,
    'One five-second budget covers the delayed version list and held marker body',
  );
  await bodyClosed;
  assert.equal(hold.writableEnded, false, 'The timeout cancels the unfinished response body');
  console.log(`Both intro requests exhausted their shared deadline after ${elapsed} ms.`);
  console.log(
    'Bundled intro client rejected mismatched runtimes, invalid identity, ambiguous versions, unsafe bounds, oversized responses, redirects, and canceled response bodies.',
  );
  if (process.argv.includes('--macos')) {
    globalThis.fetch = networkFetch;
    const { withWebEngine } = await import('./test-support/webengine.mjs');
    await writeFile(
      resolve(output, 'index.html'),
      `<!doctype html><html><head></head><body><script type="module">
      import { lookupCommunityIntro } from './markers.js';
      const networkFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        const original = new URL(url);
        if (original.origin + original.pathname !== 'https://api.theintrodb.org/v3/media') throw new Error('Unexpected intro destination');
        return networkFetch('http://127.0.0.1:${server.address().port}/' + original.search, options);
      };
      window.kinoIntroProbe = { lookup: lookupCommunityIntro };
    </script></body></html>`,
    );
    await withWebEngine(output, '/', async ({ command, evaluate, until }) => {
      await until(() => evaluate('Boolean(window.kinoIntroProbe)'), 'bundled intro client');
      async function browserLookup() {
        const result = await command('Runtime.evaluate', {
          expression: `window.kinoIntroProbe.lookup(${JSON.stringify(identity)})`,
          awaitPromise: true,
          returnByValue: true,
        });
        assert.equal(result.exceptionDetails, undefined);
        return result.result.value;
      }
      requests = [];
      bodies = [listed, selected];
      assert.deepEqual(await browserLookup(), marker);
      assert.equal(requests.length, 2);
      bodies = [{ ...media, versions: [{ duration_ms: identity.durationMs + 1 }] }];
      requests = [];
      assert.equal(await browserLookup(), null);
      assert.equal(requests.length, 1);
      bodies = [listed, 'held'];
      bodyStarted = Promise.withResolvers();
      await evaluate(`
        window.kinoIntroProbe.controller = new AbortController();
        window.kinoIntroProbe.pending = window.kinoIntroProbe.lookup(${JSON.stringify(identity)}, window.kinoIntroProbe.controller.signal)
          .then(() => 'resolved', error => error.name);
      `);
      await bodyStarted.promise;
      await evaluate('window.kinoIntroProbe.controller.abort()');
      const canceled = await command('Runtime.evaluate', {
        expression: 'window.kinoIntroProbe.pending',
        awaitPromise: true,
        returnByValue: true,
      });
      assert.equal(canceled.result.value, 'AbortError');
      hold.end('}');
      console.log(
        'Qt WebEngine accepted only the exact runtime and canceled the held marker response.',
      );
    });
  }
} finally {
  clearTimeout(delayedTimer);
  hold?.destroy();
  globalThis.fetch = networkFetch;
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
