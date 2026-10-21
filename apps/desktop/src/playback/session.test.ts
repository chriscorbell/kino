import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type { PlaybackSelection } from '../core/actions';
import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreAction, CoreRuntimeEvent, PlayerState } from '../core/types';
import { createKinoSettingsStore } from '../settingsStore';
import { preview, profile, torrentSource, urlSource } from '../test/coreState';
import { memoryStorage } from '../test/memoryStorage';
import { fakeNativePlayer } from '../test/nativePlayer';
import { resolvedPlayer } from '../test/playback';
import { KinoSettingsProvider } from '../useKinoSettings';
import { usePlaybackHost } from './react';
import { startPlayback } from './session';
import type { PlaybackDeps } from './types';

const movie = (stream = urlSource('https://media.invalid/fixture.mp4')): PlaybackSelection => ({
  meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  stream,
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: null,
});

/** A Core transport that records each write and read by name and can hold its storage. */
function fakeCore(selection: PlaybackSelection) {
  const written: string[] = [];
  const reads: string[] = [];
  /** What Core holds. A test changes it, then publishes. */
  const state = { player: resolvedPlayer(selection) as PlayerState | null, audioLanguage: 'eng' };
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const closers = new Set<() => Promise<void>>();
  let storage = Promise.resolve();
  const name = (action: CoreAction) =>
    action.action === 'Player' ? (action.args as { action: string }).action : action.action;
  return {
    written,
    reads,
    state,
    init: async () => {},
    destroy: async () => {},
    dispatch: vi.fn(async (action: CoreAction) => void written.push(name(action))),
    commit: vi.fn(async (action: CoreAction) => {
      await storage;
      written.push(`${name(action)} saved`);
    }),
    getState: (async (model: string) => {
      reads.push(model);
      return model === 'ctx'
        ? profile({
            settings: { audioLanguage: state.audioLanguage, subtitlesLanguage: null, values: {} },
          })
        : state.player;
    }) as CoreTransport['getState'],
    subscribe(listener: (event: CoreRuntimeEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Core says the model changed, and lets its readers run. */
    async publish(model: 'player' | 'ctx') {
      listeners.forEach((listener) => listener({ name: 'NewState', args: [model] }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    onBeforeDestroy(callback: () => Promise<void>) {
      closers.add(callback);
      return () => closers.delete(callback);
    },
    async prepareClose() {
      await Promise.all([...closers].map((close) => close()));
    },
    /** Holds every storage write until the returned function runs. */
    holdStorage() {
      let release!: () => void;
      storage = new Promise((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

function deps(core: ReturnType<typeof fakeCore>, overrides: Partial<PlaybackDeps> = {}) {
  return {
    core,
    settings: createKinoSettingsStore(memoryStorage()),
    native: { present: false, connect: async () => null },
    platform: Promise.resolve('web'),
    fetch: vi.fn<typeof fetch>(),
    storage: memoryStorage(),
    onFinished: vi.fn(),
    ...overrides,
  } satisfies PlaybackDeps;
}

/** Fails the final pause (Player) or Unload once its write settles, until the returned function runs. */
function failSave(core: ReturnType<typeof fakeCore>, failing: 'Player' | 'Unload') {
  const save = core.commit.getMockImplementation()!;
  let fails = true;
  core.commit.mockImplementation(async (action: CoreAction) => {
    await save(action);
    if (fails && action.action === failing) throw new Error('Storage is full.');
  });
  return () => {
    fails = false;
  };
}

/** Holds the Unload write, which comes after the save stopped the player, until the returned function runs. */
function holdUnload(core: ReturnType<typeof fakeCore>) {
  const save = core.commit.getMockImplementation()!;
  let release!: () => void;
  const unload = new Promise<void>((resolve) => (release = resolve));
  core.commit.mockImplementation(async (action: CoreAction) => {
    if (action.action === 'Unload') await unload;
    await save(action);
  });
  return release;
}

afterEach(() => vi.restoreAllMocks());

it('ignores a second play while a session is live, and starts one once it ends', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const onFinished = vi.fn();
  const settings = createKinoSettingsStore(memoryStorage());
  const { result } = renderHook(() => usePlaybackHost(onFinished), {
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(
        CoreContext.Provider,
        {
          value: {
            error: null,
            status: 'ready',
            session: 'guest',
            transport: core,
            selectSession: vi.fn(),
          },
        },
        createElement(KinoSettingsProvider, { value: settings }, children),
      ),
  });
  const loads = () => core.written.filter((write) => write === 'Load').length;

  act(() => result.current.play(selection));
  const first = result.current.session;
  act(() => result.current.play(selection));
  expect(result.current.session).toBe(first);
  expect(loads()).toBe(1);

  act(() => first!.controls.leave({ kind: 'back' }));
  await waitFor(() =>
    expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' }, selection),
  );
  expect(result.current.session).toBeNull();
  act(() => result.current.play(selection));
  expect(loads()).toBe(2);
});

it('ends as closed when the transport closes, once Unload is durable', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const onFinished = vi.fn(() => void core.written.push('finished'));
  const session = startPlayback(selection, deps(core, { onFinished }));
  await waitFor(() => expect(session.getSnapshot().waitingFor.core).toBe(false));

  await core.prepareClose();

  expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'closed' });
  expect(core.written.slice(-3)).toEqual(['PausedChanged saved', 'Unload saved', 'finished']);
});

it('names the platform the shell reports in the save window close runs', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const native = fakeNativePlayer();
  native.pauseAndSnapshot.mockResolvedValue({ time: 34567, duration: 120000 });
  startPlayback(
    selection,
    deps(core, {
      native: { present: true, connect: async () => native },
      platform: Promise.resolve('windows'),
    }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());

  await core.prepareClose();

  expect(core.dispatch).toHaveBeenCalledWith(
    {
      action: 'Player',
      args: {
        action: 'TimeChanged',
        args: { time: 34567, duration: 120000, device: 'kino-windows' },
      },
    },
    'player',
  );
});

it('leaves at once, reporting the progress unsaved, when Unload fails after the stop', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Unload');
  const native = fakeNativePlayer();
  native.pauseAndSnapshot.mockResolvedValue({ time: 34567, duration: 120000 });
  const onFinished = vi.fn();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native }, onFinished }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(onFinished).toHaveBeenCalled());
  expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back', unsaved: 'unload-failed' });
  expect(errors).toHaveBeenCalledWith('[kino:player] progress not saved', {
    reason: 'unload-failed',
  });
  expect(native.stop).toHaveBeenCalledOnce();
  expect(session.getSnapshot().exit).not.toBe('save-failed');
  const written = core.written.length;
  session.controls.leave({ kind: 'back' });
  session.controls.seek(60_000);
  session.controls.togglePause();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(onFinished).toHaveBeenCalledOnce();
  expect(core.written.slice(written)).toEqual([]);
  expect(native.seek).not.toHaveBeenCalled();
  expect(native.setPaused).not.toHaveBeenCalled();
  expect(session.getSnapshot().paused).toBe(true);
});

it('sends no command to the player once the save stopped it', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const release = holdUnload(core);
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  session.controls.toggleMute();
  expect(native.setMuted).toHaveBeenCalledExactlyOnceWith(true);

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(native.stop).toHaveBeenCalled());
  const commands = [
    native.setMuted,
    native.setVolume,
    native.setAudioTrack,
    native.setSubtitleTrack,
    native.setSubtitleDelay,
    native.addSubtitles,
  ];
  commands.forEach((command) => command.mockClear());
  session.controls.toggleMute();
  session.controls.setVolume(30);
  session.controls.selectAudio(1);
  session.controls.selectSubtitle(null);
  session.controls.addAddonSubtitle({ id: 'en', lang: 'eng', url: 'https://subs.invalid/en.srt' });
  session.controls.adjustSubtitleDelay(100);

  commands.forEach((command) => expect(command).not.toHaveBeenCalled());
  expect(session.getSnapshot()).toMatchObject({ muted: true, subtitles: { delayMs: 0 } });
  release();
});

it('loads nothing into the player when the source resolves during a save', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  core.state.player = { ...resolvedPlayer(selection), stream: null };
  const native = fakeNativePlayer();
  const onFinished = vi.fn();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native }, onFinished }),
  );
  await waitFor(() =>
    expect(session.getSnapshot().waitingFor).toEqual({ core: false, player: false, peers: false }),
  );
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  core.state.player = resolvedPlayer(selection);
  await core.publish('player');
  release();

  await waitFor(() => expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' }));
  expect(native.load).not.toHaveBeenCalled();
});

it('keeps the player working when a save fails before it stopped the player, and a retry finishes', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const succeed = failSave(core, 'Player');
  const native = fakeNativePlayer();
  const onFinished = vi.fn();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native }, onFinished }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  await native.emit('duration', { milliseconds: 120_000 });

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  expect(native.stop).not.toHaveBeenCalled();
  const written = core.written.length;
  await native.emit('time', { milliseconds: 45_000 });
  session.controls.togglePause();
  session.controls.seek(60_000);

  expect(native.setPaused).toHaveBeenLastCalledWith(false);
  expect(native.seek).toHaveBeenCalledExactlyOnceWith(60);
  expect(session.getSnapshot().position.time).toBe(60_000);
  expect(core.written.slice(written)).toContain('Seek');

  succeed();
  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' }));
  expect(native.stop).toHaveBeenCalledOnce();
});

it('loads a source that resolved during a save once that save fails', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  core.state.player = { ...resolvedPlayer(selection), stream: null };
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() =>
    expect(session.getSnapshot().waitingFor).toEqual({ core: false, player: false, peers: false }),
  );
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  core.state.player = resolvedPlayer(selection);
  await core.publish('player');
  expect(native.load).not.toHaveBeenCalled();
  expect(session.getSnapshot().loaded).toBe(false);
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  await waitFor(() => expect(native.load).toHaveBeenCalledOnce());
  expect(session.getSnapshot().loaded).toBe(true);
});

it('starts no torrent stream for a source that resolves during a save until that save fails', async () => {
  const selection = movie(torrentSource({ fileIdx: 0, sources: [] }));
  const core = fakeCore(selection);
  core.state.player = { ...resolvedPlayer(selection), stream: null };
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() =>
    expect(session.getSnapshot().waitingFor).toEqual({ core: false, player: false, peers: false }),
  );
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  core.state.player = resolvedPlayer(selection);
  await core.publish('player');
  expect(native.startStreamingEngine).not.toHaveBeenCalled();
  expect(session.getSnapshot().waitingFor.peers).toBe(false);
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  await waitFor(() => expect(native.startStreamingEngine).toHaveBeenCalledOnce());
});

it('keeps what the player describes during a save that fails, but not what moves playback', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  await native.emit('duration', { milliseconds: 120_000 });
  await native.emit('chapters', { items: [{ startMs: 1000, title: 'Intro' }] });
  await native.emit('audioTracks', {
    items: [{ id: 1, lang: 'eng', codec: 'aac', selected: true }],
  });
  await native.emit('time', { milliseconds: 45_000 });
  await native.emit('paused', { paused: false });
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  const snapshot = session.getSnapshot();
  expect(snapshot.position).toMatchObject({ time: 0, duration: 120_000 });
  expect(snapshot.paused).toBe(true);
  expect(snapshot.chapters).toHaveLength(1);
  expect(snapshot.audioTracks.map(({ id }) => id)).toEqual([1]);
});

it('fails the source when the player fails during a save that then fails', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  await native.emit('buffering', { active: true });
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  await native.emit('error', { code: 'decoder-or-stream-failed' });
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  expect(
    errors.mock.calls.filter(([event]) => event === '[kino:player] source failed'),
  ).toHaveLength(1);
  expect(session.getSnapshot()).toMatchObject({ buffering: false, paused: true });
});

it('resumes at an offset Core reports during a save once that save fails', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native } }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalled());
  await native.emit('duration', { milliseconds: 120_000 });
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  core.state.player = {
    ...resolvedPlayer(selection),
    libraryItem: { id: 'fixture', timeOffset: 50_000, videoId: 'fixture' },
  };
  await core.publish('player');
  expect(native.seek).not.toHaveBeenCalled();
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  await waitFor(() => expect(native.seek).toHaveBeenCalledExactlyOnceWith(50));
});

it('reloads with an audio output changed during a save once that save fails', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Player');
  const native = fakeNativePlayer();
  const settings = createKinoSettingsStore(memoryStorage());
  const session = startPlayback(
    selection,
    deps(core, { settings, native: { present: true, connect: async () => native } }),
  );
  await waitFor(() => expect(native.load).toHaveBeenCalledOnce());
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  settings.update({ audioOutput: 'stereo' });
  expect(native.load).toHaveBeenCalledOnce();
  release();

  await waitFor(() => expect(session.getSnapshot().exit).toBe('save-failed'));
  expect(native.load.mock.calls.map(([, stereo]) => stereo)).toEqual([false, true]);
});

it('loads nothing when the platform answers after the save stopped the player', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  failSave(core, 'Unload');
  let answer!: (platform: 'macos') => void;
  const native = fakeNativePlayer();
  const session = startPlayback(
    selection,
    deps(core, {
      native: { present: true, connect: async () => native },
      platform: new Promise((resolve) => (answer = resolve)),
    }),
  );
  await waitFor(() =>
    expect(session.getSnapshot()).toMatchObject({ loaded: true, waitingFor: { player: false } }),
  );

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(native.stop).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
  answer('macos');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(native.load).not.toHaveBeenCalled();
});

it('reads the profile languages once, so a profile sync during playback reloads nothing', async () => {
  const selection = movie();
  const core = fakeCore(selection);
  const native = fakeNativePlayer();
  startPlayback(selection, deps(core, { native: { present: true, connect: async () => native } }));
  await waitFor(() => expect(native.load).toHaveBeenCalled());

  core.state.audioLanguage = 'fra';
  await core.publish('ctx');
  await core.publish('player');

  expect(native.load).toHaveBeenCalledOnce();
  expect(native.stop).not.toHaveBeenCalled();
  expect(core.reads.filter((model) => model === 'ctx')).toEqual(['ctx']);
});

it('joins a running Back save when the source fails, and Back wins', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const selection = movie(torrentSource({ fileIdx: 0, sources: [] }));
  const core = fakeCore(selection);
  const native = fakeNativePlayer();
  const onFinished = vi.fn();
  const session = startPlayback(
    selection,
    deps(core, { native: { present: true, connect: async () => native }, onFinished }),
  );
  await waitFor(() => expect(native.startStreamingEngine).toHaveBeenCalled());
  const release = core.holdStorage();

  session.controls.leave({ kind: 'back' });
  await waitFor(() => expect(core.commit).toHaveBeenCalled());
  expect(session.getSnapshot().exit).toBe('saving');
  await native.streamingEngineChanged.emit('', 'The streaming engine stopped.');
  expect(errors).toHaveBeenCalledWith(
    '[kino:player] source failed',
    expect.objectContaining({ message: 'The streaming engine stopped.' }),
  );
  release();

  await waitFor(() => expect(onFinished).toHaveBeenCalled());
  expect(onFinished).toHaveBeenCalledExactlyOnceWith({ kind: 'back' });
  expect(core.written.filter((write) => write === 'Unload saved')).toHaveLength(1);
});
