import { settingShown, shellCapabilities } from '@kino/settings';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { defaultSettings, type KinoSettings } from '../settings';
import { preview, urlSource, video } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback } from '../test/playback';

// A setting something reads can still change nothing (#98). Each Kino setting a desktop platform
// lists either changes playback, shown by running one scripted playback at two of its values and
// reading back what the player was told or what the view shows, or is named as outside playback.
// A setting runs on each backend whose Settings shows it.

const url = 'https://media.invalid/episode.mkv';
const selection = {
  meta: preview({ id: 'tt0903747', name: 'Breaking Bad', type: 'series' }),
  stream: urlSource(url),
  metaTransportUrl: 'https://addon.invalid/manifest.json',
  streamTransportUrl: 'https://addon.invalid/manifest.json',
  video: video({ id: 'tt0903747:1:1', season: 1, episode: 1 }),
  nextVideo: video({ id: 'tt0903747:1:2', title: 'Cat in the Bag', season: 1, episode: 2 }),
};
// The community intro TheIntroDB lists for this runtime, so both backends have an intro.
const runtime = 3_500_192;
const intro = { start_ms: 228_664, end_ms: 246_143 };

const backends = [
  ['native', 'macos'],
  ['browser', 'web'],
] as const;
type Backend = (typeof backends)[number][0];

// A shell that can match the refresh rate, so matchRefreshRate reaches the player.
const shellPlayer = () =>
  fakeNativePlayer({ setMatchFrameRate: vi.fn<(enabled: boolean) => void>() });

interface Playback {
  native: ReturnType<typeof shellPlayer>;
  media: {
    duration(milliseconds: number): Promise<void>;
    time(milliseconds: number): Promise<void>;
  };
  /** The volume the player was last told, in percent. */
  volume(): number | undefined;
}

interface PlaybackCase<Key extends keyof KinoSettings> {
  /** Plays the same script at whatever value the setting holds and returns what it changed. */
  observe(playback: Playback): Promise<unknown>;
  /** Two values, each with what `observe` returns at it. */
  at: readonly [readonly [KinoSettings[Key], unknown], readonly [KinoSettings[Key], unknown]];
}

const shows = (name: string) => screen.queryByText(name) !== null;
const insideIntro = async ({ media }: Playback) => {
  await media.duration(runtime);
  await waitFor(() =>
    expect(console.info).toHaveBeenCalledWith(
      '[kino:intro] trusted community marker',
      expect.anything(),
    ),
  );
  await media.time(230_000);
};

const outsidePlayback = {
  interfaceScale: 'It sizes the interface; the scale probe and useInterfaceScale.test.tsx hold it.',
};

const cases: {
  [Key in Exclude<keyof KinoSettings, keyof typeof outsidePlayback>]: PlaybackCase<Key>;
} = {
  audioOutput: {
    observe: async ({ native }) => native.load.mock.calls.map(([, stereo]) => ({ stereo })),
    at: [
      ['auto', [{ stereo: false }]],
      ['stereo', [{ stereo: true }]],
    ],
  },
  volume: {
    observe: async (playback) => playback.volume(),
    at: [
      [30, 30],
      [70, 70],
    ],
  },
  subtitles: {
    async observe({ native }) {
      await native.emit('subtitleTracks', { items: [{ id: 3, lang: 'eng', codec: 'subrip' }] });
      await native.emit('ready');
      return native.setSubtitleTrack.mock.calls;
    },
    at: [
      [false, []],
      [true, [[3]]],
    ],
  },
  subtitleSize: {
    observe: async ({ native }) => native.setSubtitleScale.mock.lastCall,
    at: [
      [80, [0.8]],
      [150, [1.5]],
    ],
  },
  subtitlePosition: {
    observe: async ({ native }) => native.setSubtitlePosition.mock.lastCall,
    at: [
      [70, [70]],
      [90, [90]],
    ],
  },
  matchRefreshRate: {
    observe: async ({ native }) => new Set(native.setMatchFrameRate.mock.calls.flat()),
    at: [
      [false, new Set([false])],
      [true, new Set([true])],
    ],
  },
  upNext: {
    async observe({ media }) {
      await media.duration(600_000);
      await media.time(590_000);
      return shows('Up Next');
    },
    at: [
      [true, true],
      [false, false],
    ],
  },
  skipIntroButton: {
    async observe(playback) {
      await insideIntro(playback);
      return shows('Skip Intro');
    },
    at: [
      [true, true],
      [false, false],
    ],
  },
  automaticIntroSkipping: {
    async observe(playback) {
      await insideIntro(playback);
      return { skipped: shows('Intro skipped'), offered: shows('Skip Intro') };
    },
    at: [
      [false, { skipped: false, offered: true }],
      [true, { skipped: true, offered: false }],
    ],
  },
};

const playbackCases = Object.entries(cases) as [
  keyof typeof cases,
  PlaybackCase<keyof typeof cases>,
][];

const runs = playbackCases.flatMap(([key, entry]) =>
  backends
    .filter(([, platform]) => settingShown(key, platform, new Set(shellCapabilities)))
    .flatMap(([backend]) =>
      entry.at.map(([value, seen]) => [key, value, backend, entry.observe, seen] as const),
    ),
);

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  // jsdom does not implement playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const media = { tmdb_id: 1396, type: 'tv', season: 1, episode: 1 };
      const body = new URL(input).searchParams.has('list_versions')
        ? { ...media, versions: [{ duration_ms: runtime, submission_count: 10 }] }
        : { ...media, intro: [intro] };
      return Response.json(body);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function play(backend: Backend, settings: Partial<KinoSettings>): Promise<Playback> {
  const native = shellPlayer();
  const { view } = await mountPlayback({
    selection,
    native: backend === 'native' ? native : null,
    settings,
  });
  if (backend === 'native') {
    await waitFor(() => expect(native.load).toHaveBeenCalled());
    return {
      native,
      media: {
        duration: (milliseconds) => native.emit('duration', { milliseconds }),
        time: (milliseconds) => native.emit('time', { milliseconds }),
      },
      volume: () => native.setVolume.mock.lastCall?.[0],
    };
  }
  const element = () => view.container.querySelector('video')!;
  await waitFor(() => expect(element().getAttribute('src')).toBe(url));
  const dom = (event: string, property: 'currentTime' | 'duration', milliseconds: number) =>
    act(async () => {
      Object.defineProperty(element(), property, {
        configurable: true,
        writable: true,
        value: milliseconds / 1000,
      });
      fireEvent(element(), new Event(event));
    });
  return {
    native,
    media: {
      duration: (milliseconds) => dom('durationchange', 'duration', milliseconds),
      time: (milliseconds) => dom('timeupdate', 'currentTime', milliseconds),
    },
    volume: () => Math.round(element().volume * 100),
  };
}

it('names every setting a desktop platform lists, as a playback case or outside playback', () => {
  expect([...Object.keys(cases), ...Object.keys(outsidePlayback)].sort()).toEqual(
    Object.keys(defaultSettings).sort(),
  );
  expect(new Set(runs.map(([key]) => key)), 'each case runs on some backend').toEqual(
    new Set(Object.keys(cases)),
  );
});

it.each(playbackCases)('expects a different playback at each value of %s', (_key, entry) => {
  expect(entry.at[0][1]).not.toEqual(entry.at[1][1]);
});

it.each(runs)('plays %s at %j on the %s backend', async (key, value, backend, observe, seen) => {
  expect(await observe(await play(backend, { [key]: value }))).toEqual(seen);
});
