import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PlayerState } from '../core/types';
import { hints, preview, urlSource } from '../test/coreState';
import { fakeNativePlayer } from '../test/nativePlayer';
import { mountPlayback } from '../test/playback';

const native = fakeNativePlayer();

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
        nextVideo: null,
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
      native.load.mockClear();
      await mountPlayback({
        selection: {
          meta: preview({ id: 'fixture', name: 'Fixture', type: 'movie' }),
          metaTransportUrl: 'https://addon.invalid/manifest.json',
          stream,
          streamTransportUrl: 'https://addon.invalid/manifest.json',
          video: null,
        },
        native,
        player: () => state,
      });
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
