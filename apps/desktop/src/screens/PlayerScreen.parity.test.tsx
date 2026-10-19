import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { CoreSource } from '../core/types';
import type { KinoSettings } from '../settings';
import { preview, video } from '../test/coreState';
import { renderWithSettings } from '../test/renderWithSettings';
import { PlayerScreen } from './PlayerScreen';

// The native player and the browser's <video> must tell Core the same story.
// Each case drives one backend through what it reports and reads back what
// PlayerScreen sent to Core.

type Listener = (name: string, payload: Record<string, unknown>) => void;

const fixture = vi.hoisted(() => {
  const listeners = new Set<Listener>();
  return {
    nativeShell: true,
    resumeAt: 0,
    listeners,
    stream: {
      description: null,
      name: null,
      source: { kind: 'url', url: 'https://media.invalid/fixture.mp4' },
      hints: {
        bingeGroup: null,
        countryWhitelist: null,
        filename: null,
        notWebReady: null,
        proxyRequestHeaders: null,
        proxyResponseHeaders: null,
        videoHash: null,
        videoSize: null,
      },
    } satisfies CoreSource,
    transport: { dispatch: vi.fn().mockResolvedValue(undefined) },
    native: {
      load: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
      setPaused: vi.fn(),
      setVolume: vi.fn(),
      setSubtitleScale: vi.fn(),
      setSubtitlePosition: vi.fn(),
      setNowPlayingMetadata: vi.fn(),
      fullscreen: false,
      fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
      playerEvent: {
        connect: (listener: Listener) => listeners.add(listener),
        disconnect: (listener: Listener) => listeners.delete(listener),
      },
    },
  };
});
vi.mock('../native/player', () => ({
  nativeShellPresent: () => fixture.nativeShell,
  knownShellReport: () => ({
    platform: fixture.nativeShell ? 'macos' : 'web',
    capabilities: new Set(),
  }),
  connectNativePlayer: async () => fixture.native,
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: fixture.transport }) }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: {
      stream: { type: 'Ready', content: fixture.stream },
      libraryItem: { id: 'show', timeOffset: fixture.resumeAt, videoId: null },
    },
    loading: false,
    error: null,
    unload: async () => {},
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.listeners.clear();
  fixture.resumeAt = 0;
  // jsdom does not implement playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

/** What Core heard, as `Report` or `Report:time` or `Report:paused`. */
function reports() {
  return fixture.transport.dispatch.mock.calls.map(([action]) => {
    const report = (action as { args: { action: string; args?: Record<string, unknown> } }).args;
    const detail = report.args?.time ?? report.args?.paused;
    return detail === undefined ? report.action : `${report.action}:${String(detail)}`;
  });
}

const selection = {
  meta: preview({ id: 'show', name: 'Fixture', type: 'series' }),
  stream: fixture.stream,
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: video({ id: 'ep1', title: 'Episode one', season: 1, episode: 1 }),
  nextVideo: video({ id: 'ep2', title: 'Episode two', season: 1, episode: 2 }),
};

async function play(kind: 'native' | 'browser') {
  fixture.nativeShell = kind === 'native';
  const noop = () => {};
  const view = renderWithSettings(
    <PlayerScreen
      selection={selection}
      preferredSubtitleLanguage={null}
      onBack={noop}
      onSourceFailure={noop}
      onUpNext={noop}
    />,
  );
  const element = () => view.container.querySelector('video')!;
  if (kind === 'native') await waitFor(() => expect(fixture.native.load).toHaveBeenCalled());
  else await waitFor(() => expect(element().getAttribute('src')).toBe(fixture.stream.source.url));

  const emit = (name: string, payload: Record<string, unknown> = {}) =>
    act(async () => fixture.listeners.forEach((listener) => listener(name, payload)));
  const dom = (event: string, property?: 'currentTime' | 'duration', milliseconds = 0) =>
    act(async () => {
      if (property) {
        Object.defineProperty(element(), property, {
          configurable: true,
          writable: true,
          value: milliseconds / 1000,
        });
      }
      fireEvent(element(), new Event(event));
    });
  const media =
    kind === 'native'
      ? {
          duration: (milliseconds: number) => emit('duration', { milliseconds }),
          time: (milliseconds: number) => emit('time', { milliseconds }),
          paused: (paused: boolean) => emit('paused', { paused }),
          ended: () => emit('ended'),
          ready: () => emit('ready'),
          buffering: (active: boolean) => emit('buffering', { active }),
        }
      : {
          duration: (milliseconds: number) => dom('durationchange', 'duration', milliseconds),
          time: (milliseconds: number) => dom('timeupdate', 'currentTime', milliseconds),
          paused: (paused: boolean) => dom(paused ? 'pause' : 'play'),
          // A browser that reaches the end pauses first.
          ended: async () => {
            await dom('pause');
            await dom('ended');
          },
          ready: () => dom('loadedmetadata'),
          buffering: (active: boolean) => dom(active ? 'waiting' : 'canplay'),
        };
  return {
    element,
    media,
    reload: (settings: Partial<KinoSettings>) => act(() => view.store.update(settings)),
  };
}

const backends = ['native', 'browser'] as const;

it.each(backends)('reports a pause as TimeChanged then PausedChanged (%s)', async (kind) => {
  const { media } = await play(kind);
  await media.duration(120_000);
  await media.time(30_000);
  await media.time(31_000);
  expect(reports()).toEqual(['TimeChanged:30000']);
  fixture.transport.dispatch.mockClear();
  await media.paused(true);
  expect(reports()).toEqual(['TimeChanged:31000', 'PausedChanged:true']);
  fixture.transport.dispatch.mockClear();
  await media.paused(false);
  expect(reports()).toEqual(['PausedChanged:false']);
});

it.each(backends)('reports an end as TimeChanged then Ended (%s)', async (kind) => {
  const { media } = await play(kind);
  await media.duration(120_000);
  await media.time(119_000);
  fixture.transport.dispatch.mockClear();
  await media.ended();
  expect(reports()).toEqual(
    kind === 'native'
      ? ['TimeChanged:119000', 'Ended']
      : ['TimeChanged:119000', 'PausedChanged:true', 'TimeChanged:119000', 'Ended'],
  );
});

it.each(backends)('shows buffering until the player says it can play (%s)', async (kind) => {
  const { media } = await play(kind);
  await media.buffering(true);
  expect(screen.getByText('Buffering…')).toBeInTheDocument();
  await media.ready();
  expect(screen.getByText('Buffering…')).toBeInTheDocument();
  await media.buffering(false);
  expect(screen.queryByText('Buffering…')).not.toBeInTheDocument();
});

it("re-reads the browser's paused state when a source's metadata arrives", async () => {
  const { element, media } = await play('browser');
  await media.paused(false);
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  fixture.transport.dispatch.mockClear();
  // Loading a new source pauses the element without a pause event.
  Object.defineProperty(element(), 'paused', { configurable: true, value: true });
  await media.ready();
  expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  expect(reports()).toEqual(['VideoParamsChanged']);
});

it.each(backends)('reports VideoParamsChanged once per load (%s)', async (kind) => {
  const { media, reload } = await play(kind);
  await media.ready();
  await media.ready();
  expect(reports()).toEqual(['VideoParamsChanged']);
  reload({ audioOutput: 'stereo' });
  if (kind === 'native') await waitFor(() => expect(fixture.native.load).toHaveBeenCalledTimes(2));
  await media.ready();
  await media.ready();
  expect(reports()).toEqual(['VideoParamsChanged', 'VideoParamsChanged']);
});

it.each(backends)('clears the end-of-file offer on a rewind (%s)', async (kind) => {
  const { media } = await play(kind);
  await media.duration(1_800_000);
  await media.time(600_000);
  expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
  await media.ended();
  expect(screen.getByRole('button', { name: /Choose source/i })).toBeInTheDocument();
  await media.time(20_000);
  expect(screen.queryByRole('button', { name: /Choose source/i })).not.toBeInTheDocument();
});

it.each(backends)("reports a viewer's toggle once, from the player's answer (%s)", async (kind) => {
  const { media } = await play(kind);
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  if (kind === 'native') expect(fixture.native.setPaused).toHaveBeenCalledExactlyOnceWith(false);
  else expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  expect(reports()).toEqual([]);
  await media.paused(false);
  expect(reports()).toEqual(['PausedChanged:false']);
});

it.each(backends)('reports each seek once (%s)', async (kind) => {
  const { media } = await play(kind);
  await media.duration(120_000);
  fixture.transport.dispatch.mockClear();
  fireEvent.change(screen.getByRole('slider', { name: 'Playback position' }), {
    target: { value: '20000' },
  });
  expect(reports()).toEqual(['Seek:20000']);
});

it.each(backends)('reports the resume seek (%s)', async (kind) => {
  fixture.resumeAt = 30_000;
  const { media } = await play(kind);
  await media.duration(120_000);
  await waitFor(() => expect(reports()).toEqual(['Seek:30000']));
});
