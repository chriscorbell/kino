import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoreSource } from '../core/types';
import { defaultSettings, type KinoSettings } from '../settings';
import { preview, video } from '../test/coreState';
import { PlayerScreen } from './PlayerScreen';

const fixture = vi.hoisted(() => ({
  stream: {
    description: null,
    name: null,
    source: { kind: 'url', url: 'https://media.invalid/episode.mkv' },
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
    setVolume: vi.fn(),
    setMuted: vi.fn(),
    fullscreen: false,
    fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
    playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
    setSubtitleScale: vi.fn(),
    setSubtitlePosition: vi.fn(),
    setNowPlayingMetadata: vi.fn(),
  },
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  playbackDevice: () => 'kino-macos',
  connectNativePlayer: async () => fixture.native,
}));
vi.mock('../core/context', () => ({ useCore: () => ({ transport: fixture.transport }) }));
vi.mock('../core/useCoreModel', () => ({
  useCoreModel: () => ({
    state: { stream: { type: 'Ready', content: fixture.stream } },
    loading: false,
    error: null,
    unload: async () => {},
  }),
}));

// A real file's runtime, a few seconds off the version TheIntroDB lists for the episode.
const runtime = 3_496_512;
const selection = {
  meta: preview({ id: 'tt0903747', name: 'Breaking Bad', type: 'series' }),
  stream: fixture.stream,
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: video({ id: 'tt0903747:1:1', season: 1, episode: 1 }),
  nextVideo: null,
};
const chapters = [
  { startMs: 0, title: 'Prologue' },
  { startMs: 60_000, title: 'Opening' },
  { startMs: 90_000, title: 'Episode' },
];
const requests: URL[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  requests.length = 0;
  // Shaped as the live service answers for this episode.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      requests.push(url);
      const media = { tmdb_id: 1396, type: 'tv', season: 1, episode: 1 };
      const body = url.searchParams.has('list_versions')
        ? {
            ...media,
            versions: [
              { duration_ms: 3_500_192, average_duration_ms: 3_495_986, submission_count: 10 },
              { duration_ms: 0, submission_count: 7 },
              { duration_ms: 2_839_000, average_duration_ms: 2_839_000, submission_count: 2 },
            ],
          }
        : { ...media, intro: [{ start_ms: 228_664, end_ms: 246_143 }] };
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

async function play(settings: Partial<KinoSettings> = {}) {
  const noop = () => {};
  render(
    <PlayerScreen
      selection={selection}
      settings={{ ...defaultSettings, ...settings }}
      onSettingsChange={noop}
      preferredSubtitleLanguage={null}
      onBack={noop}
      onSourceFailure={noop}
      onUpNext={noop}
    />,
  );
  await waitFor(() => expect(fixture.native.playerEvent.connect).toHaveBeenCalled());
  return (name: string, payload: Record<string, unknown>) =>
    act(async () => fixture.native.playerEvent.connect.mock.calls.at(-1)?.[0](name, payload));
}

it('offers Skip Intro inside a chapter intro and seeks to its end', async () => {
  const emit = await play();
  await emit('chapters', { items: chapters });
  await emit('duration', { milliseconds: runtime });
  await emit('time', { milliseconds: 30_000 });
  expect(screen.queryByRole('button', { name: 'Skip Intro' })).toBeNull();
  await emit('time', { milliseconds: 65_000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Skip Intro' }));
  expect(fixture.native.seek).toHaveBeenLastCalledWith(90);
  expect(screen.queryByRole('button', { name: 'Skip Intro' })).toBeNull();
  expect(requests, 'A chapter intro needs no community lookup').toHaveLength(0);
});

it('finds the community intro for a runtime a few seconds off the listed version', async () => {
  const emit = await play();
  await emit('duration', { milliseconds: runtime });
  await waitFor(() => expect(requests).toHaveLength(2));
  for (const request of requests) {
    expect(request.searchParams.get('imdb_id')).toBe('tt0903747');
    expect(request.searchParams.get('season')).toBe('1');
    expect(request.searchParams.get('episode')).toBe('1');
    expect(request.searchParams.get('duration_ms')).toBe(String(runtime));
  }
  await emit('time', { milliseconds: 230_000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Skip Intro' }));
  expect(fixture.native.seek).toHaveBeenLastCalledWith(246.143);
});

it('skips an intro automatically once, and Undo returns to it without skipping again', async () => {
  const emit = await play({ automaticIntroSkipping: true });
  await emit('chapters', { items: chapters });
  await emit('duration', { milliseconds: runtime });
  await emit('time', { milliseconds: 61_000 });
  await waitFor(() => expect(fixture.native.seek).toHaveBeenLastCalledWith(90));
  expect(screen.getByText('Intro skipped')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(fixture.native.seek).toHaveBeenLastCalledWith(60);
  expect(screen.queryByText('Intro skipped')).toBeNull();
  await emit('time', { milliseconds: 61_000 });
  expect(fixture.native.seek).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Skip Intro' })).toBeInTheDocument();
});
