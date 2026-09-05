import assert from 'node:assert/strict';

import { loadCatalogAction, loadLibraryAction } from '../apps/desktop/src/core/actions.ts';
import { adaptCoreState, adaptDiscoverState } from '../apps/desktop/src/core/adapters.ts';
import { CatalogPaging } from '../apps/desktop/src/core/catalogPaging.ts';
import { initializeCore } from './test-support/core-stream.mjs';

const deadline = setTimeout(() => {
  console.error('Core pagination did not settle.');
  process.exit(1);
}, 15_000);
let paging;
const core = await initializeCore({
  onEvent(event) {
    if (event.name === 'NewState' && event.args.includes('discover')) paging?.updated();
  },
});
// Production reads Discover through the adapter before paging annotates it.
paging = new CatalogPaging(
  { dispatch: core.dispatch, getState: () => adaptDiscoverState(core.get_state('discover')) },
  () => {},
);
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const snapshot = () => paging.snapshot(adaptDiscoverState(core.get_state('discover')));
const request = (genre = 'Comedy') => ({
  base: 'https://v3-cinemeta.strem.io/manifest.json',
  path: { resource: 'catalog', type: 'movie', id: 'top', extra: [['genre', genre]] },
});
const requests = [];
let failure = null;
let hold = false;
let release;
const responseFor = (skip) =>
  Response.json({
    // The second page repeats the first page's last item. Core deduplicates it,
    // but the following offset must still count that returned record.
    metas: Array.from({ length: skip === 0 ? 100 : skip === 100 ? 26 : 0 }, (_, i) => ({
      id: `title-${skip === 100 ? i + 99 : i}`,
      name: `Title ${skip === 100 ? i + 99 : i}`,
      type: 'movie',
    })),
  });
globalThis.fetch = paging.observeFetch(async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  requests.push(url);
  const skip = Number(/skip=(\d+)/.exec(url)?.[1] ?? 0);
  if (skip > 0 && hold)
    return new Promise((resolve) => {
      release = () => resolve(responseFor(skip));
    });
  if (skip === 126 && failure === 'third') return new Response(null, { status: 500 });
  if (skip === 0 && failure === 'first') return new Response(null, { status: 500 });
  if (skip > 0 && failure === 'http') return new Response(null, { status: 500 });
  if (skip > 0 && failure === 'invalid')
    return Response.json({ metas: [{ name: 'Missing identity' }] });
  if (skip > 0 && failure === 'network') throw new Error('Synthetic network failure');
  return responseFor(skip);
});
const load = async (genre = 'Comedy') => {
  paging.reset();
  core.dispatch({ action: 'Unload' }, 'discover', '');
  core.dispatch(loadCatalogAction(request(genre)), 'discover', '');
  await tick();
  assert.equal(snapshot().catalog.content.content.length, 100);
};

for (let index = 0; index < 125; index += 1) {
  core.dispatch(
    {
      action: 'Ctx',
      args: {
        action: 'AddToLibrary',
        args: {
          id: `saved-${index}`,
          name: `Saved ${String(index).padStart(3, '0')}`,
          type: 'movie',
        },
      },
    },
    undefined,
    '',
  );
}
for (const [page, length, nextPage] of [
  [1, 100, true],
  [2, 125, false],
]) {
  core.dispatch(loadLibraryAction({ page, sort: 'name', type: 'movie' }), 'library', '');
  await tick();
  const state = adaptCoreState('library', core.get_state('library'));
  assert.equal(state.catalog.length, length);
  assert.equal(state.selectable.nextPage, nextPage);
  assert.deepEqual(state.selected.request, { page, sort: 'name', type: 'movie' });
}

for (const kind of ['http', 'network', 'invalid']) {
  await load();
  failure = kind;
  await assert.rejects(paging.loadNext(''));
  assert.equal(snapshot().catalog.content.content.length, 100);
  assert.deepEqual(snapshot().paging, { loading: false, error: true });
  failure = null;
  await paging.loadNext('');
  assert.equal(snapshot().catalog.content.content.length, 125);
  assert.equal(new Set(snapshot().catalog.content.content.map((item) => item.id)).size, 125);
  assert.deepEqual(snapshot().paging, { loading: false, error: false });
  await paging.loadNext('');
  assert.equal(snapshot().catalog.content.content.length, 125);
  assert.equal(snapshot().selectable.nextPage, false);
  assert.equal(snapshot().paging.error, false);
}
assert(requests.some((url) => url.includes('skip=126')));
assert(requests.every((url) => url.includes('genre=Comedy')));

await load();
await paging.loadNext('');
failure = 'third';
await assert.rejects(paging.loadNext(''));
assert.equal(snapshot().catalog.content.content.length, 125);
failure = 'first';
await assert.rejects(paging.loadNext(''));
assert.equal(snapshot().catalog.content.content.length, 125);
failure = null;
await paging.loadNext('');
assert.equal(snapshot().catalog.content.content.length, 125);
assert.equal(snapshot().selectable.nextPage, false);
assert.equal(snapshot().paging.error, false);

await load();
hold = true;
const pending = paging.loadNext('');
assert.equal(paging.loadNext(''), pending, 'Repeated requests share the same operation.');
await tick();
assert.equal(snapshot().paging.loading, true);
assert.equal(snapshot().catalog.content.content.length, 100);
assert(release);
const releaseOldPage = release;
hold = false;
await load('Drama');
await pending;
releaseOldPage();
await tick();
assert.equal(snapshot().selected.request.path.extra[0][1], 'Drama');
assert.equal(snapshot().catalog.content.content.length, 100);
assert.deepEqual(snapshot().paging, { loading: false, error: false });

clearTimeout(deadline);
console.log(
  'Pinned Core paging reaches all 125 library/catalog titles, preserves filters, deduplicates, retries failed pages, and ignores cancelled pages.',
);
process.exit(0);
