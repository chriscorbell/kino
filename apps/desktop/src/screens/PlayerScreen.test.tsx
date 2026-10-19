import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { PlayerState } from '../core/types';
import { hints, preview, urlSource } from '../test/coreState';
import { renderWithSettings } from '../test/renderWithSettings';
import { PlayerScreen } from './PlayerScreen';

const native = await vi.hoisted(async () => {
  const { fakeNativePlayer } = await import('../test/nativePlayer');
  return fakeNativePlayer();
});
vi.mock('../native/player', () => ({
  nativeShellPresent: () => true,
  knownShellReport: () => ({ platform: 'macos', capabilities: new Set() }),
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
      const stream = urlSource('https://media.invalid/video.mp4', {
        hints: hints({ proxyRequestHeaders: headers }),
      });
      // Core resolves a header-bearing direct stream to its streaming-server
      // proxy. The native backend sends the headers itself instead.
      const state: PlayerState = {
        libraryItem: null,
        selected: { stream },
        stream: {
          type: 'Ready',
          content: {
            source: {
              kind: 'url',
              url: `${service}/proxy/d=https%3A%2F%2Fmedia.invalid&h=Referer%3Ahttps%3A%2F%2Frequired.invalid%2F/video.mp4`,
            },
          },
        },
        subtitles: [],
        title: null,
      };
      const transport: CoreTransport = {
        destroy: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
        prepareClose: vi.fn().mockResolvedValue(undefined),
        onBeforeDestroy: () => () => {},
        dispatch: vi.fn().mockResolvedValue(undefined),
        getState: (async () => state) as CoreTransport['getState'],
        init: vi.fn().mockResolvedValue(undefined),
        subscribe: () => () => {},
      };
      native.load.mockClear();
      renderWithSettings(
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
              meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
              metaTransportUrl: 'https://addon.invalid/manifest.json',
              stream,
              streamTransportUrl: 'https://addon.invalid/manifest.json',
              video: null,
              nextVideo: null,
            }}
            preferredSubtitleLanguage={null}
            onBack={vi.fn()}
            onSourceFailure={vi.fn()}
            onUpNext={vi.fn()}
          />
        </CoreContext.Provider>,
      );
      await waitFor(() =>
        expect(native.load).toHaveBeenCalledExactlyOnceWith(
          'https://media.invalid/video.mp4',
          false,
          headers,
        ),
      );
    },
  );
});
