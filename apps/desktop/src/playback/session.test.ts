import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type { PlaybackSelection } from '../core/actions';
import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreAction } from '../core/types';
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
  nextVideo: null,
});

/** A Core transport that records each write by name and can hold its storage. */
function fakeCore(selection: PlaybackSelection) {
  const written: string[] = [];
  const closers = new Set<() => Promise<void>>();
  let storage = Promise.resolve();
  const name = (action: CoreAction) =>
    action.action === 'Player' ? (action.args as { action: string }).action : action.action;
  return {
    written,
    init: async () => {},
    destroy: async () => {},
    dispatch: vi.fn(async (action: CoreAction) => void written.push(name(action))),
    commit: vi.fn(async (action: CoreAction) => {
      await storage;
      written.push(`${name(action)} saved`);
    }),
    getState: (async (model: string) =>
      model === 'ctx' ? profile() : resolvedPlayer(selection)) as CoreTransport['getState'],
    subscribe: () => () => {},
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
