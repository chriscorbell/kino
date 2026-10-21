// Drives the production playback session over the pinned Core WASM through every way playback
// ends, with a scripted native player standing in for the shell. Each exit must save the player's
// last position, stop the player, then Unload, and report its outcome only once that save is
// durable. A save that fails before the stop leaves playback usable and starts over when the
// viewer leaves again; one that fails after the stop leaves nothing able to move the player.
import assert from 'node:assert/strict';

import { adaptCoreState } from '../apps/desktop/src/core/adapters.ts';
import { PendingCoreWork } from '../apps/desktop/src/core/pendingWork.ts';
import { startPlayback } from '../apps/desktop/src/playback/session.ts';
import { createKinoSettingsStore } from '../apps/desktop/src/settingsStore.ts';
import { memoryStorage } from '../apps/desktop/src/test/memoryStorage.ts';
import { fixturePreview, fixtureSource, initializeCore } from './test-support/core-stream.mjs';

const listeners = new Set();
const storage = new Map();
const core = await initializeCore({
  storage,
  onEvent: (event) => listeners.forEach((listener) => listener(event)),
});
const work = new PendingCoreWork();

// Holds Core's storage writes until the case lands or fails them.
let held = null;
const hold = () => {
  held = Promise.withResolvers();
  held.promise.catch(() => undefined);
};
const land = () => {
  held.resolve();
  held = null;
};
const failWrites = () => {
  held.reject(new Error('Storage is full.'));
  held = null;
};
globalThis.local_storage_set_item = (key, value) =>
  work.track(
    (async () => {
      await held?.promise;
      storage.set(key, value);
    })(),
  );

// Neither the final pause after a progress report nor Unload writes anything, so a commit that
// fails with nothing written fails here, as the worker's flush does when storage or account sync
// times out.
let flushAnswer = null;

/** The transport's Player half over the in-process Core, as core.worker.ts carries it. */
function connectCore() {
  const closers = new Set();
  const subscriptions = new Set();
  let destroyed = false;
  const prepareClose = async () => {
    await Promise.all([...closers].map((close) => close()));
    await work.flush();
  };
  return {
    port: {
      async dispatch(action, model) {
        if (destroyed) throw new Error('Core stopped.');
        core.dispatch(action, model, '');
      },
      async commit(action, model) {
        if (destroyed) throw new Error('Core stopped.');
        core.dispatch(action, model, '');
        await work.flush();
        await flushAnswer?.(action);
      },
      async getState(model) {
        return adaptCoreState(model, core.get_state(model));
      },
      subscribe(listener) {
        listeners.add(listener);
        subscriptions.add(listener);
        return () => listeners.delete(listener);
      },
      onBeforeDestroy(callback) {
        closers.add(callback);
        return () => closers.delete(callback);
      },
    },
    // Window close and Quit wait for this; Core teardown runs it and then stops the transport.
    prepareClose,
    async destroy() {
      await prepareClose();
      destroyed = true;
      subscriptions.forEach((listener) => listeners.delete(listener));
    },
  };
}

const savedTime = () =>
  JSON.parse(storage.get('library_recent') ?? '{"items":{}}').items[fixturePreview.id]?.state
    .timeOffset;
const playerLoaded = () => core.get_state('player').selected !== null;
const coreTime = () => adaptCoreState('player', core.get_state('player')).libraryItem?.timeOffset;
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
async function until(condition, what) {
  for (let waited = 0; !condition(); waited += 5) {
    assert.ok(waited < 5000, `Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const fixtureUrl = 'https://media.invalid/fixture.mp4';
const engineUrl = 'http://engine.invalid';
const nextVideo = {
  id: 'kino-fixture:1:2',
  title: 'Next',
  season: 1,
  episode: 2,
  released: null,
  thumbnail: null,
  watched: false,
};
const selection = (stream) => ({
  meta: fixturePreview,
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  stream: fixtureSource(stream),
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: null,
  nextVideo,
});

/** The shell's player as far as the session uses it, recording what it was asked to do. */
function scriptedPlayer() {
  const events = new Set();
  const engines = new Set();
  const calls = [];
  // What Core held each time the player stopped.
  const stops = [];
  let frozen = { time: 0, duration: 0 };
  const ignore = () => {};
  const signal = { connect: ignore, disconnect: ignore };
  const shell = {
    calls,
    stops,
    since: (mark) => calls.slice(mark),
    emit: (name, payload = {}) => events.forEach((listener) => listener(name, payload)),
    freezeAt(time) {
      frozen = { time, duration: 120000 };
    },
    // Progress reports carry an earlier time, so only the exit's own capture can store this one.
    pausesAt(time) {
      shell.freezeAt(time);
      shell.emit('duration', { milliseconds: 120000 });
      shell.emit('time', { milliseconds: time - 4000 });
    },
    player: {
      platform: 'macos',
      shellVersion: '0.0.0',
      fullscreen: false,
      fullscreenChanged: signal,
      streamingEngineChanged: {
        connect: (listener) => engines.add(listener),
        disconnect: (listener) => engines.delete(listener),
      },
      playerEvent: {
        connect: (listener) => events.add(listener),
        disconnect: (listener) => events.delete(listener),
      },
      load: (url, stereo) => calls.push(`load ${url}${stereo ? ' stereo' : ''}`),
      pauseAndSnapshot: async () => {
        calls.push('pause');
        return frozen;
      },
      stop: () => {
        calls.push('stop');
        stops.push({ saved: savedTime(), loaded: playerLoaded() });
      },
      startStreamingEngine: () =>
        queueMicrotask(() => engines.forEach((listener) => listener(engineUrl, ''))),
      setPaused: () => calls.push('setPaused'),
      seek: () => calls.push('seek'),
      openAccountCreation: async () => false,
      addSubtitles: ignore,
      setAudioTrack: ignore,
      setFullscreen: ignore,
      setMuted: ignore,
      setNowPlayingMetadata: ignore,
      setSubtitleDelay: ignore,
      setSubtitlePosition: ignore,
      setSubtitleScale: ignore,
      setSubtitleTrack: ignore,
      setVolume: ignore,
    },
  };
  return shell;
}

function start({ stream = { url: fixtureUrl }, fetch } = {}) {
  const shell = scriptedPlayer();
  const outcomes = [];
  const settings = createKinoSettingsStore(memoryStorage());
  const connection = connectCore();
  const session = startPlayback(selection(stream), {
    core: connection.port,
    settings,
    native: { present: true, connect: async () => shell.player },
    platform: Promise.resolve('macos'),
    fetch: fetch ?? (() => Promise.reject(new Error('The session gate has no network.'))),
    storage: memoryStorage(),
    onFinished: (outcome) => outcomes.push(outcome),
  });
  return { connection, outcomes, session, settings, shell };
}

/** Plays the fixture until the player has reported progress short of `time`, where it pauses. */
async function play(time) {
  const playback = start();
  await until(() => playback.shell.calls.includes(`load ${fixtureUrl}`), 'the load');
  playback.shell.pausesAt(time);
  await work.flush();
  return playback;
}

const originalError = console.error;
console.error = (...args) => {
  if (!String(args[0]).startsWith('[kino:')) originalError(...args);
};

// The exit, the outcome it reports, and how the viewer or the shell takes it.
const exits = [
  ['back', 'back', ({ session }) => session.controls.leave({ kind: 'back' })],
  [
    'upNext',
    'upNext',
    ({ session }) => session.controls.leave({ kind: 'upNext', video: nextVideo }),
  ],
  ['failed', 'failed', ({ shell }) => shell.emit('error', { code: 'decoder-or-stream-failed' })],
  ['window close or Quit', 'closed', ({ connection }) => connection.prepareClose()],
  ['Core teardown', 'closed', ({ connection }) => connection.destroy()],
];

// Positions only move forward across cases, because each play resumes from the last saved one
// and Core ignores progress behind a seek until the player passes it.
let time = 30000;
const advance = (milliseconds = 5000) => (time += milliseconds);
for (const [exit, kind, run] of exits) {
  advance();
  const playback = await play(time);
  const { outcomes, session, shell } = playback;
  hold();
  const closing = run(playback);
  await settle();
  assert.equal(session.getSnapshot().exit, 'saving', `${exit}: the save is running.`);
  assert.deepEqual(outcomes, [], `${exit}: the outcome waits for the save to be durable.`);
  assert.notEqual(savedTime(), time, `${exit}: nothing is durable while storage is held.`);
  assert.deepEqual(shell.stops, [], `${exit}: the player plays until the pause is durable.`);
  land();
  if (closing) {
    await closing;
    assert.equal(savedTime(), time, `${exit}: the window closes only after the position is saved.`);
    assert.ok(!playerLoaded(), `${exit}: the window closes only after Unload.`);
  }
  await until(() => outcomes.length > 0, `the ${exit} outcome`);
  await settle();
  assert.equal(outcomes.length, 1, `${exit}: the outcome is reported once.`);
  assert.equal(outcomes[0].kind, kind);
  assert.equal(savedTime(), time, `${exit}: the last position is saved.`);
  assert.deepEqual(
    shell.stops,
    [{ saved: time, loaded: true }],
    `${exit}: the player stops once, after the final pause is durable and before Unload.`,
  );
  assert.ok(!playerLoaded(), `${exit}: the save ends with Unload.`);
}

{
  advance();
  const { connection, outcomes, session, shell } = await play(time);
  hold();
  session.controls.leave({ kind: 'back' });
  await settle();
  let closed = false;
  const closing = connection.prepareClose().then(() => {
    closed = true;
  });
  await settle();
  assert.equal(closed, false, 'Window close during a save waits for that save.');
  land();
  await closing;
  await settle();
  assert.deepEqual(outcomes, [{ kind: 'back' }], 'An exit during a save joins it.');
  assert.equal(
    shell.calls.filter((call) => call === 'pause').length,
    1,
    'One save froze the player.',
  );
  assert.equal(shell.stops.length, 1, 'One save stopped the player.');
  assert.equal(savedTime(), time);
}

{
  advance();
  const { outcomes, session, shell } = await play(time);
  hold();
  session.controls.leave({ kind: 'back' });
  await settle();
  failWrites();
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed save');
  assert.deepEqual(outcomes, [], 'A save that fails before the stop keeps playback open.');
  assert.deepEqual(shell.stops, [], 'A save that fails before the stop leaves the player playing.');
  assert.ok(playerLoaded(), 'A save that fails before the stop leaves Core loaded.');
  const mark = shell.calls.length;
  session.controls.togglePause();
  session.controls.seek(10000);
  assert.deepEqual(shell.since(mark), ['setPaused', 'seek'], 'The controls reach the player.');
  shell.emit('time', { milliseconds: advance(20000) });
  await until(() => coreTime() === time, 'the progress report');
  shell.freezeAt(advance());
  session.controls.leave({ kind: 'back' });
  await until(() => outcomes.length > 0, 'the retried save');
  assert.deepEqual(outcomes, [{ kind: 'back' }]);
  assert.deepEqual(shell.since(mark + 2), ['pause', 'stop'], 'Leaving again saves from the top.');
  assert.equal(savedTime(), time, 'Leaving again saves the position it captures.');
  assert.ok(!playerLoaded());
}

{
  advance();
  const { outcomes, session, shell } = await play(time);
  flushAnswer = (action) => {
    if (action.action !== 'Unload') return;
    flushAnswer = null;
    throw new Error('Storage is full.');
  };
  session.controls.leave({ kind: 'back' });
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed Unload');
  assert.deepEqual(outcomes, [], 'A failed Unload reports no outcome.');
  assert.deepEqual(shell.stops, [{ saved: time, loaded: true }]);
  const mark = shell.calls.length;
  const { position } = session.getSnapshot();
  session.controls.togglePause();
  session.controls.seek(10000);
  shell.emit('time', { milliseconds: time + 5000 });
  assert.deepEqual(shell.since(mark), [], 'No control reaches a stopped player.');
  assert.deepEqual(session.getSnapshot().position, position, 'A stopped player moves nothing.');
  session.controls.leave({ kind: 'back' });
  await until(() => outcomes.length > 0, 'the retried Unload');
  assert.deepEqual(outcomes, [{ kind: 'back' }]);
  assert.equal(savedTime(), time, 'The retry keeps the position the first attempt saved.');
  assert.ok(!playerLoaded());
}

{
  const engine = Promise.withResolvers();
  const torrent = { infoHash: '0123456789abcdef0123456789abcdef01234567', fileIdx: 0 };
  let created = false;
  const { session, shell } = start({
    stream: torrent,
    fetch: async () => {
      created = true;
      await engine.promise;
      return Response.json({});
    },
  });
  await until(() => created, 'the engine request');
  const flushed = Promise.withResolvers();
  flushAnswer = () => flushed.promise;
  session.controls.leave({ kind: 'back' });
  await settle();
  engine.resolve();
  await settle();
  const loads = () => shell.calls.filter((call) => call.startsWith('load '));
  assert.ok(session.getSnapshot().loaded, 'The source arrived during the save.');
  assert.deepEqual(loads(), [], 'Nothing loads while a save runs.');
  flushAnswer = null;
  flushed.reject(new Error('Storage is full.'));
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed save');
  await settle();
  assert.deepEqual(
    loads(),
    [`load ${engineUrl}/${torrent.infoHash}/0`],
    'A source that arrived during a failed save loads once.',
  );
}

{
  advance();
  const { session, settings, shell } = await play(time);
  const mark = shell.calls.length;
  hold();
  session.controls.leave({ kind: 'back' });
  await settle();
  settings.update({ audioOutput: 'stereo' });
  await settle();
  assert.deepEqual(shell.since(mark), ['pause'], 'Nothing reloads while a save runs.');
  failWrites();
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed save');
  await settle();
  assert.deepEqual(
    shell.since(mark),
    ['pause', 'stop', `load ${fixtureUrl} stereo`],
    'An audio output changed during a failed save reloads once it fails.',
  );
}

console.log(
  'Pinned Core playback session: Back, Up Next, a source failure, window close and Core teardown each saved the last position, stopped, then unloaded; an exit during a save joined it; a save that failed before the stop stayed usable and saved from the top, one that failed after it left the player inert, and a source or audio output that changed during a failed save loaded once.',
);
// Core owns repeating runtime timers, as it does in its browser worker.
process.exit(0);
