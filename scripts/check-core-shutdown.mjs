import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { playerAction } from '../apps/desktop/src/core/actions.ts';
import { PendingCoreWork, trackCoreSync } from '../apps/desktop/src/core/pendingWork.ts';
import { initializeCore, resolveCoreStream } from './test-support/core-stream.mjs';

const mode = process.argv[2];
if (!mode) {
  const initializedStorage = new Map();
  const defaults = (await initializeCore({ storage: initializedStorage })).get_state('ctx').profile
    .settings;
  for (const session of ['guest', 'account']) {
    const result = spawnSync(
      process.execPath,
      [
        process.argv[1],
        session,
        JSON.stringify(defaults),
        initializedStorage.get('schema_version'),
      ],
      {
        stdio: 'inherit',
        timeout: 15000,
      },
    );
    assert.equal(result.status, 0, `${session} Core shutdown check failed.`);
  }
  process.exit(0);
} else {
  const storage = new Map([['schema_version', process.argv[4]]]);
  if (mode === 'account') {
    storage.set(
      'profile',
      JSON.stringify({
        auth: {
          key: 'synthetic-account-never-sent-to-a-network',
          user: {
            _id: 'synthetic-account',
            email: 'fixture@kino.invalid',
            lastModified: '2026-01-01T00:00:00Z',
            dateRegistered: '2026-01-01T00:00:00Z',
            premium_expire: null,
            gdpr_consent: { tos: true, privacy: true, marketing: false, from: null },
          },
        },
        addons: [],
        settings: JSON.parse(process.argv[3]),
      }),
    );
  }
  const core = await initializeCore({ storage });
  assert.equal(Boolean(core.get_state('ctx').profile.auth), mode === 'account');
  const work = new PendingCoreWork();
  let held = false;
  const storageGate = Promise.withResolvers();
  const syncGate = Promise.withResolvers();
  const finalSyncStarted = Promise.withResolvers();
  const synced = [];
  globalThis.local_storage_set_item = (key, value) =>
    work.track(
      (async () => {
        if (held) await storageGate.promise;
        storage.set(key, value);
      })(),
    );
  const metadataFetch = globalThis.fetch;
  globalThis.fetch = trackCoreSync(async (request) => {
    if (!request.url.endsWith('/datastorePut')) return metadataFetch(request);
    const { changes } = await request.clone().json();
    if (held) finalSyncStarted.resolve();
    // Deliver HTTP headers immediately, but withhold the response body until
    // the fixture has accepted the write. Shutdown must await both.
    return new Response(
      new ReadableStream({
        async start(controller) {
          if (held) await syncGate.promise;
          synced.push(...changes);
          controller.enqueue(new TextEncoder().encode('{"result":{"success":true}}'));
          controller.close();
        },
      }),
    );
  }, work);
  await resolveCoreStream(core, { url: 'https://media.invalid/fixture.mp4' });
  const progress = (time) =>
    core.dispatch(
      playerAction('TimeChanged', { time, duration: 120000, device: 'kino-macos' }),
      'player',
      '',
    );
  progress(30000);
  await work.flush();
  core.dispatch({ action: 'Unload' }, 'player', '');
  progress(34567);
  await work.flush();
  const savedTime = () =>
    JSON.parse(storage.get('library_recent')).items['kino-fixture'].state.timeOffset;
  assert.equal(
    savedTime(),
    30000,
    'The old Unload-before-TimeChanged order must reproduce the lost position.',
  );

  await resolveCoreStream(core, { url: 'https://media.invalid/fixture.mp4' });
  held = true;
  progress(34567);
  core.dispatch(playerAction('PausedChanged', { paused: true }), 'player', '');
  let flushed = false;
  const flushing = work.flush().then(() => {
    flushed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(flushed, false, 'Flush must wait for the storage bridge acknowledgement.');
  assert.equal(savedTime(), 30000);
  storageGate.resolve();
  if (mode === 'account') {
    await finalSyncStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(flushed, false, 'Flush must wait for the account write response body.');
  }
  syncGate.resolve();
  await flushing;
  assert.equal(savedTime(), 34567);
  if (mode === 'account') assert.equal(synced.at(-1).state.timeOffset, 34567);
  core.dispatch({ action: 'Unload' }, 'player', '');
  await work.flush();
  assert.equal(savedTime(), 34567);
  console.log(
    `Pinned Core ${mode} shutdown saved 34,567 ms before unload and awaited storage${mode === 'account' ? ' and account sync' : ''}.`,
  );
  // Core owns repeating runtime timers, as it does in its browser worker.
  process.exit(0);
}
