import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import { defaultSettings } from '../settings';
import { PlayerScreen } from './PlayerScreen';

const native = vi.hoisted(() => ({
  load: vi.fn(),
  pauseAndSnapshot: vi.fn().mockResolvedValue({ time: 0, duration: 0 }),
  stop: vi.fn(),
  fullscreen: false,
  fullscreenChanged: { connect: vi.fn(), disconnect: vi.fn() },
  playerEvent: { connect: vi.fn(), disconnect: vi.fn() },
  setSubtitleScale: vi.fn(),
  setSubtitlePosition: vi.fn(),
  setNowPlayingMetadata: vi.fn(),
}));
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  connectNativePlayer: async () => native,
}));

describe('native direct sources', () => {
  it.each(['http://127.0.0.1:11470', 'https://stale-service.invalid'])(
    'passes the original media URL and headers instead of the Core proxy at %s',
    async (service) => {
      const headers = {
        Referer: 'https://required.invalid/',
        Authorization: 'Bearer synthetic-test-value',
      };
      const stream = {
        url: 'https://media.invalid/video.mp4',
        behaviorHints: { proxyHeaders: { request: headers } },
        deepLinks: { player: '' },
      };
      const state = {
        selected: { stream },
        stream: {
          type: 'Ready',
          content: {
            url: `${service}/proxy/d=https%3A%2F%2Fmedia.invalid&h=Referer%3Ahttps%3A%2F%2Frequired.invalid%2F/video.mp4`,
            deepLinks: { player: '' },
          },
        },
      };
      const transport: CoreTransport = {
        destroy: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
        prepareClose: vi.fn().mockResolvedValue(undefined),
        onBeforeDestroy: () => () => {},
        dispatch: vi.fn().mockResolvedValue(undefined),
        getState: async <State,>() => state as State,
        init: vi.fn().mockResolvedValue(undefined),
        subscribe: () => () => {},
      };
      native.load.mockClear();
      render(
        <CoreContext.Provider
          value={{
            error: null,
            status: 'ready',
            session: 'guest',
            selectSession: vi.fn(),
            transport,
          }}
        >
          <PlayerScreen
            selection={{
              meta: {
                id: 'fixture',
                name: 'Fixture',
                type: 'movie',
                inLibrary: false,
                watched: false,
              },
              metaTransportUrl: 'https://addon.invalid/manifest.json',
              stream,
              streamTransportUrl: 'https://addon.invalid/manifest.json',
              video: null,
              nextVideo: null,
            }}
            settings={defaultSettings}
            preferredSubtitleLanguage={null}
            onBack={vi.fn()}
            onSettingsChange={vi.fn()}
            onSourceFailure={vi.fn()}
            onUpNext={vi.fn()}
          />
        </CoreContext.Provider>,
      );
      await waitFor(() =>
        expect(native.load).toHaveBeenCalledExactlyOnceWith(stream.url, false, headers),
      );
    },
  );
});
