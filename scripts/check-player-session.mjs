// Drives the production playback session over the pinned Core WASM through every way playback
// ends, with a scripted native player standing in for the shell. Each exit must save the player's
// last position, stop the player, then Unload, and report its outcome only once that save is
// durable. A save that fails before the stop leaves playback usable and starts over when the
// viewer leaves again. Once the player stopped, no control or report reaches it, and an Unload
// whose write fails or does not finish in time leaves at once and reports why progress is
// unsaved. Once the Core worker has stopped, leaving reports the outcome and stops the player
// instead of retrying a save that cannot succeed. Over a series, the player offers Core's
// next episode unless it is upcoming, and resumes only an offset saved for the episode it plays.
import assert from 'node:assert/strict';

import { adaptCoreState } from '../apps/desktop/src/core/adapters.ts';
import { commitThrough } from '../apps/desktop/src/core/commit.ts';
import { CoreStoppedError } from '../apps/desktop/src/core/errors.ts';
import { PendingCoreWork } from '../apps/desktop/src/core/pendingWork.ts';
import { startPlayback } from '../apps/desktop/src/playback/session.ts';
import { createKinoSettingsStore } from '../apps/desktop/src/settingsStore.ts';
import { memoryStorage } from '../apps/desktop/src/test/memoryStorage.ts';
import { fixturePreview, fixtureSource, initializeCore } from './test-support/core-stream.mjs';

// Every case starts on its own Core and storage, so no case depends on what another left behind.
let storage;
let core;
let work;
// How long a flush waits for storage and account sync, when a case shortens Core's own limit.
let flushTimeout;
// Each case's transport stands for its own worker, so only the newest one hears Core.
let deliver = () => {};
let generation = 0;
async function freshCore() {
  storage = new Map();
  work = new PendingCoreWork();
  flushTimeout = undefined;
  held = null;
  heldWrites = 0;
  sessionLogs.length = 0;
  const current = ++generation;
  core = await initializeCore({
    storage,
    onEvent: (event) => current === generation && deliver(event),
  });
  globalThis.local_storage_set_item = heldStorage;
}

// Holds Core's storage writes until the case lands or fails them, counting the writes it holds.
let held = null;
let heldWrites = 0;
const hold = () => {
  held = Promise.withResolvers();
  held.promise.catch(() => undefined);
};
const release = (settle) => {
  settle(held);
  held = null;
  heldWrites = 0;
};
const land = () => release((writes) => writes.resolve());
const failWrites = () => release((writes) => writes.reject(new Error('Storage is full.')));
const heldStorage = (key, value) =>
  work.track(
    (async () => {
      if (held) heldWrites += 1;
      await held?.promise;
      storage.set(key, value);
    })(),
  );

/**
 * core/transport.ts over the in-process Core, which it cannot load under Node because it imports a
 * Vite worker. Window close and Quit wait for `prepareClose`; Core teardown runs it and stops the
 * transport whether or not the save succeeded. `die` stops it as a failed worker does, which also
 * fails a flush still waiting on storage.
 */
function connectCore() {
  const listeners = new Set();
  deliver = (event) => listeners.forEach((listener) => listener(event));
  const beforeDestroy = new Set();
  let stopped = null;
  const stopping = Promise.withResolvers();
  stopping.promise.catch(() => undefined);
  const live = () => {
    if (stopped) throw stopped;
  };
  const dispatch = async (action, model) => {
    live();
    core.dispatch(action, model, '');
  };
  const flush = async () => {
    live();
    await Promise.race([work.flush(flushTimeout), stopping.promise]);
  };
  const prepareClose = async () => {
    live();
    await Promise.all([...beforeDestroy].map((callback) => callback()));
    await flush();
  };
  let destroying = null;
  const stop = (message) => {
    stopped ??= new CoreStoppedError(message);
    stopping.reject(stopped);
    listeners.clear();
  };
  return {
    port: {
      dispatch,
      commit: commitThrough(dispatch, flush),
      async getState(model) {
        live();
        return adaptCoreState(model, core.get_state(model));
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onBeforeDestroy(callback) {
        beforeDestroy.add(callback);
        return () => beforeDestroy.delete(callback);
      },
    },
    prepareClose,
    destroy() {
      destroying ??= prepareClose().finally(() => stop('Stremio Core has stopped.'));
      return destroying;
    },
    die: () => stop('Stremio Core stopped responding. Try starting it again.'),
  };
}

const savedTime = () =>
  JSON.parse(storage.get('library_recent') ?? '{"items":{}}').items[fixturePreview.id]?.state
    .timeOffset;
const playerLoaded = () => core.get_state('player').selected !== null;
const coreTime = () => adaptCoreState('player', core.get_state('player')).libraryItem?.timeOffset;
// sleep-ok: gives work that must not happen a chance to, before a negative assertion.
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
async function until(condition, what) {
  for (let waited = 0; !condition(); waited += 5) {
    assert.ok(waited < 5000, `Timed out waiting for ${what}.`);
    // sleep-ok: the poll interval of a 5 s deadline.
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const heldWrite = () => until(() => heldWrites > 0, 'the held write');

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
      setSubtitlePosition: () => calls.push('setSubtitlePosition'),
      setSubtitleScale: () => calls.push('setSubtitleScale'),
      setSubtitleTrack: ignore,
      setVolume: ignore,
    },
  };
  return shell;
}

function start({ stream = { url: fixtureUrl }, fetch, chosen = selection(stream) } = {}) {
  const shell = scriptedPlayer();
  const outcomes = [];
  const settings = createKinoSettingsStore(memoryStorage());
  const connection = connectCore();
  const session = startPlayback(chosen, {
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

// The session logs every failure a case plants, so they show only when that case fails.
const originalError = console.error;
const sessionLogs = [];
console.error = (...args) => {
  if (String(args[0]).startsWith('[kino:')) sessionLogs.push(args);
  else originalError(...args);
};

const cases = [];
const gateCase = (name, run) => cases.push([name, run]);

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

for (const [exit, kind, run] of exits) {
  gateCase(`${exit} saves, stops, then unloads`, async () => {
    const time = 35000;
    const playback = await play(time);
    const { outcomes, session, shell } = playback;
    hold();
    const closing = run(playback);
    await heldWrite();
    assert.equal(session.getSnapshot().exit, 'saving', `${exit}: the save is running.`);
    assert.deepEqual(outcomes, [], `${exit}: the outcome waits for the save to be durable.`);
    assert.notEqual(savedTime(), time, `${exit}: nothing is durable while storage is held.`);
    assert.deepEqual(shell.stops, [], `${exit}: the player plays until the pause is durable.`);
    land();
    if (closing) {
      await closing;
      assert.equal(
        savedTime(),
        time,
        `${exit}: the window closes only after the position is saved.`,
      );
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
  });
}

gateCase('an exit during a save joins it', async () => {
  const time = 35000;
  const { connection, outcomes, session, shell } = await play(time);
  hold();
  session.controls.leave({ kind: 'back' });
  await heldWrite();
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
});

gateCase('a save that fails before the stop stays usable and saves from the top', async () => {
  const { outcomes, session, shell } = await play(35000);
  hold();
  session.controls.leave({ kind: 'back' });
  await heldWrite();
  failWrites();
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed save');
  assert.deepEqual(outcomes, [], 'A save that fails before the stop keeps playback open.');
  assert.deepEqual(shell.stops, [], 'A save that fails before the stop leaves the player playing.');
  assert.ok(playerLoaded(), 'A save that fails before the stop leaves Core loaded.');
  const mark = shell.calls.length;
  session.controls.togglePause();
  session.controls.seek(10000);
  assert.deepEqual(shell.since(mark), ['setPaused', 'seek'], 'Pause and seek reach the player.');
  shell.emit('time', { milliseconds: 30000 });
  await until(() => coreTime() === 30000, 'the progress report');
  shell.freezeAt(40000);
  session.controls.leave({ kind: 'back' });
  await until(() => outcomes.length > 0, 'the retried save');
  assert.deepEqual(outcomes, [{ kind: 'back' }]);
  assert.deepEqual(shell.since(mark + 2), ['pause', 'stop'], 'Leaving again saves from the top.');
  assert.equal(savedTime(), 40000, 'Leaving again saves the position it captures.');
  assert.ok(!playerLoaded());
});

gateCase('a save that fails at Core teardown fails the teardown', async () => {
  const { connection, outcomes, session, shell } = await play(35000);
  let events = 0;
  connection.port.subscribe(() => (events += 1));
  hold();
  const teardown = connection.destroy();
  await heldWrite();
  failWrites();
  await assert.rejects(teardown, 'Core teardown hears that the save failed.');
  let lateCloses = 0;
  connection.port.onBeforeDestroy(async () => {
    lateCloses += 1;
  });
  await assert.rejects(connection.prepareClose(), 'A stopped Core refuses a second close.');
  assert.equal(lateCloses, 0, 'A second close after Core teardown runs no save.');
  const eventsBefore = events;
  deliver({ name: 'NewState', args: ['player'] });
  assert.equal(events, eventsBefore, 'A stopped Core delivers no late event.');
  assert.equal(session.getSnapshot().exit, 'save-failed', 'The teardown save failed.');
  assert.deepEqual(outcomes, [], 'A save that fails at Core teardown reports no outcome.');
  session.controls.leave({ kind: 'back' });
  await until(() => outcomes.length > 0, 'leaving after Core teardown');
  assert.deepEqual(
    outcomes,
    [{ kind: 'back', unsaved: 'core-stopped' }],
    'Leaving a stopped Core leaves and reports the progress unsaved.',
  );
  assert.equal(shell.stops.length, 1, 'Leaving a stopped Core stops the player.');
});

gateCase('a worker that dies during the save leaves unsaved', async () => {
  const { connection, outcomes, session, shell } = await play(35000);
  hold();
  session.controls.leave({ kind: 'back' });
  await heldWrite();
  connection.die();
  await until(() => outcomes.length > 0, 'leaving as the Core worker died during the save');
  assert.deepEqual(
    outcomes,
    [{ kind: 'back', unsaved: 'core-stopped' }],
    'A worker that dies while the final pause waits on storage fails the save as stopped.',
  );
  assert.equal(shell.stops.length, 1, 'The player stops once, without Unload.');
  assert.notEqual(session.getSnapshot().exit, 'save-failed', 'No retry is offered.');
  land();
});

gateCase('leaving after the worker died leaves unsaved', async () => {
  const { connection, outcomes, session, shell } = await play(35000);
  const saved = savedTime();
  connection.die();
  session.controls.leave({ kind: 'upNext', video: nextVideo });
  await until(() => outcomes.length > 0, 'leaving after the Core worker died');
  await settle();
  assert.deepEqual(
    outcomes,
    [{ kind: 'upNext', video: nextVideo, unsaved: 'core-stopped' }],
    'Leaving after the Core worker died reports the outcome, unsaved.',
  );
  assert.deepEqual(
    shell.stops,
    [{ saved, loaded: true }],
    'Leaving after the Core worker died stops the player without saving.',
  );
  assert.ok(
    sessionLogs.some(([event]) => event === '[kino:player] progress not saved'),
    'The lost save is logged.',
  );
  session.controls.leave({ kind: 'back' });
  await settle();
  assert.equal(outcomes.length, 1, 'Leaving again reports nothing more.');
});

gateCase('a torrent that arrives during a failed save loads once', async () => {
  const engine = Promise.withResolvers();
  const torrent = { infoHash: '0123456789abcdef0123456789abcdef01234567', fileIdx: 0 };
  let created = false;
  hold();
  const { session, shell } = start({
    stream: torrent,
    fetch: async () => {
      created = true;
      await engine.promise;
      return Response.json({});
    },
  });
  await until(() => created, 'the engine request');
  session.controls.leave({ kind: 'back' });
  await settle();
  engine.resolve();
  await settle();
  const loads = () => shell.calls.filter((call) => call.startsWith('load '));
  assert.equal(session.getSnapshot().loaded, false, 'A source that arrives during a save waits.');
  assert.deepEqual(loads(), [], 'Nothing loads while a save runs.');
  failWrites();
  await until(() => session.getSnapshot().exit === 'save-failed', 'the failed save');
  await settle();
  assert.ok(session.getSnapshot().loaded, 'The source shows once the save failed.');
  assert.deepEqual(
    loads(),
    [`load ${engineUrl}/${torrent.infoHash}/0`],
    'A source that arrived during a failed save loads once.',
  );
});

gateCase('the progress a session reports never moves its viewer', async () => {
  const { shell } = await play(35000);
  await until(() => coreTime() > 0, 'the progress report');
  await settle();
  assert.ok(!shell.calls.includes('seek'), 'A title with no saved offset never seeks to its own.');
});

gateCase('an audio output changed during a failed save reloads once', async () => {
  const { session, settings, shell } = await play(35000);
  const mark = shell.calls.length;
  hold();
  session.controls.leave({ kind: 'back' });
  await heldWrite();
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
});

gateCase('a series resumes its own episode and offers the next one', async () => {
  // Core loads the series from this add-on and lists the special last. It calls season two's
  // episode upcoming, because the series has scheduled videos and the release is still to come.
  const episode = (season, number, released) => ({
    id: `kino-series:${season}:${number}`,
    title: `Episode ${number}`,
    season,
    episode: number,
    released,
  });
  const series = {
    id: 'kino-series',
    type: 'series',
    name: 'Synthetic series',
    posterShape: 'poster',
    behaviorHints: { hasScheduledVideos: true },
    videos: [
      episode(1, 1, '2020-01-01T00:00:00.000Z'),
      episode(1, 2, '2020-01-08T00:00:00.000Z'),
      episode(2, 1, '2999-01-01T00:00:00.000Z'),
      episode(0, 1, '2020-01-15T00:00:00.000Z'),
    ],
  };
  globalThis.fetch = async () => Response.json({ meta: series });
  const playEpisode = async (id, at) => {
    const playback = start({
      chosen: {
        ...selection({ url: fixtureUrl }),
        meta: { ...fixturePreview, id: series.id, name: series.name, type: 'series' },
        video: { id },
      },
    });
    await until(() => playback.shell.calls.includes(`load ${fixtureUrl}`), 'the episode load');
    await until(() => core.get_state('player').metaItem?.type === 'Ready', 'the series');
    playback.shell.pausesAt(at);
    await work.flush();
    return playback;
  };
  const leave = async ({ outcomes, session }) => {
    session.controls.leave({ kind: 'back' });
    await until(() => outcomes.length > 0, 'the episode exit');
  };
  const offered = ({ session }) => session.getSnapshot().nextVideo?.id ?? null;
  const seeks = ({ shell }) => shell.calls.filter((call) => call === 'seek').length;

  const second = await playEpisode('kino-series:1:2', 60000);
  assert.equal(offered(second), null, 'Up Next offers no upcoming episode.');
  await leave(second);
  const again = await playEpisode('kino-series:1:2', 90000);
  assert.equal(seeks(again), 1, 'The episode resumes at its own saved offset.');
  await leave(again);
  const first = await playEpisode('kino-series:1:1', 30000);
  assert.equal(offered(first), 'kino-series:1:2', "Up Next offers Core's next episode.");
  assert.equal(seeks(first), 0, 'An offset saved for another episode does not move the player.');
  await leave(first);
  const last = await playEpisode('kino-series:2:1', 30000);
  assert.equal(offered(last), null, 'Up Next offers no special after a numbered season.');
  await leave(last);
});

// After an ended playback Unload writes the reset offset, so its write is the one that fails or stalls.
for (const [failure, unsaved] of [
  ['fails', 'unload-failed'],
  ['does not finish in time', 'unload-timed-out'],
]) {
  gateCase(
    `an Unload that ${failure} after an ended playback leaves at once, unsaved`,
    async () => {
      const { outcomes, session, settings, shell } = await play(35000);
      const end = 119500;
      shell.pausesAt(end);
      shell.emit('ended');
      const stop = shell.player.stop;
      shell.player.stop = () => {
        stop();
        hold();
      };
      if (unsaved === 'unload-timed-out') flushTimeout = 50;
      session.controls.leave({ kind: 'back' });
      await heldWrite();
      const mark = shell.calls.length;
      const { position } = session.getSnapshot();
      session.controls.togglePause();
      session.controls.seek(10000);
      session.controls.adjustSubtitleSize(10);
      session.controls.adjustSubtitlePosition(-5);
      settings.update({ subtitleSize: settings.get().subtitleSize + 20 });
      shell.emit('time', { milliseconds: end - 1000 });
      assert.deepEqual(
        shell.since(mark),
        [],
        'Pause, seek and the subtitle style do not reach a stopped player.',
      );
      assert.deepEqual(
        session.getSnapshot().position,
        position,
        'Progress from a stopped player moves nothing.',
      );
      if (unsaved === 'unload-failed') failWrites();
      await until(
        () => session.getSnapshot().exit !== 'saving' || outcomes.length > 0,
        'the Unload that did not land',
      );
      assert.deepEqual(
        outcomes,
        [{ kind: 'back', unsaved }],
        `An Unload that ${failure} after the stop leaves at once and reports why progress is unsaved.`,
      );
      assert.deepEqual(shell.stops, [{ saved: end, loaded: true }], 'The player stopped once.');
      assert.ok(!playerLoaded(), 'Core unloaded before its write settled.');
      assert.equal(
        savedTime(),
        end,
        "Storage still holds the offset Unload's reset would replace.",
      );
      session.controls.leave({ kind: 'back' });
      await settle();
      assert.equal(outcomes.length, 1, 'Leaving again reports nothing more.');
      if (held) land();
    },
  );
}

// Cases run in a new order each time, so one that leans on another's leftovers fails. A failure
// names the seed that replays its order.
const seed = Number(process.env.KINO_SESSION_SEED ?? Math.floor(Math.random() * 2 ** 32));
let state = seed >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let mixed = Math.imul(state ^ (state >>> 15), state | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32;
};
for (let index = cases.length - 1; index > 0; index -= 1) {
  const other = Math.floor(random() * (index + 1));
  [cases[index], cases[other]] = [cases[other], cases[index]];
}
for (const [name, run] of cases) {
  await freshCore();
  try {
    await run();
  } catch (error) {
    sessionLogs.forEach((args) => originalError(...args));
    originalError(`Player session case "${name}" failed; replay with KINO_SESSION_SEED=${seed}.`);
    throw error;
  }
}

console.log(
  `Pinned Core playback session, ${cases.length} cases on fresh Cores in shuffled order (KINO_SESSION_SEED=${seed}): Back, Up Next, a source failure, window close and Core teardown each saved the last position, stopped, then unloaded; an exit during a save joined it; a save that failed before the stop stayed usable and saved from the top, one that failed at Core teardown reached the teardown; leaving after Core teardown, after the Core worker died, or as it died during the save stopped the player once and reported the outcome as unsaved; a source that arrived during a save waited for it, and it or an audio output that changed during a failed save loaded once; a title never sought to progress it reported itself; a series resumed only its own episode's offset and offered Core's next episode, but no upcoming one and no special after a numbered season; and after an ended playback, a stopped player ignored pause, seek, the subtitle style and progress, and an Unload whose write failed or did not finish in time after the stop left at once and reported which.`,
);
// Core owns repeating runtime timers, as it does in its browser worker.
process.exit(0);
