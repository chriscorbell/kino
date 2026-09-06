import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '../../global.css';
import { CoreContext } from '../../core/context';
import type { CoreTransport } from '../../core/transport';
import type { CoreSource, PlayerState } from '../../core/types';
import { connectNativePlayer } from '../../native/player';
import { PlayerScreen } from '../../screens/PlayerScreen';
import { defaultSettings } from '../../settings';
import { preview, video } from '../coreState';

const root = createRoot(document.getElementById('root')!);
let generation = 0;
const probe = {
  connected: false,
  closed: true,
  ready: false,
  events: [] as unknown[],
  audio: [] as { id: number; lang?: string; selected: boolean }[],
  subtitles: [] as { id: number; lang?: string; selected: boolean; external?: boolean }[],
  open(id: string, episode = 0, file = 'two-tracks.mkv', language = 'eng', enabled = true) {
    probe.ready = false;
    probe.closed = false;
    probe.audio = [];
    probe.subtitles = [];
    const stream: CoreSource = {
      name: null,
      description: null,
      source: { kind: 'url', url: `${location.origin}/${file}` },
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
    };
    const state: PlayerState = {
      libraryItem: null,
      selected: null,
      title: 'Track fixture',
      stream: { type: 'Ready', content: stream },
      subtitles: [
        ...(id === 'failed-addon-show'
          ? [
              {
                id: `failed-${episode}`,
                lang: 'spa',
                url: `${location.origin}/missing-subtitle.srt?episode=${episode}`,
              },
            ]
          : []),
        {
          id: `addon-${episode}-first`,
          lang: 'spa',
          url: `${location.origin}/track-spa.srt?episode=${episode}`,
        },
        {
          id: `addon-${episode}-second`,
          lang: 'spa',
          url: `${location.origin}/track-spa.srt?episode=${episode}&variant=second`,
        },
      ],
    };
    const transport = {
      init: async () => {},
      destroy: async () => {},
      flush: async () => {},
      prepareClose: async () => {},
      onBeforeDestroy: () => () => {},
      dispatch: async () => {},
      getState: async () => state,
      subscribe: () => () => {},
    } as CoreTransport;
    root.render(
      <CoreContext.Provider
        key={++generation}
        value={{
          error: null,
          status: 'ready',
          session: 'guest',
          transport,
          selectSession: () => {},
        }}
      >
        <PlayerScreen
          selection={{
            meta: preview({ id, type: episode ? 'series' : 'movie', name: 'Track fixture' }),
            video: episode ? video({ id: `${id}:1:${episode}`, season: 1, episode }) : null,
            nextVideo: null,
            stream,
            metaTransportUrl: 'https://addon.invalid/manifest.json',
            streamTransportUrl: 'https://addon.invalid/manifest.json',
          }}
          settings={{ ...defaultSettings, subtitles: enabled }}
          preferredAudioLanguage={language}
          preferredSubtitleLanguage={language}
          onSettingsChange={() => {}}
          onBack={() => {
            probe.closed = true;
            root.render(null);
          }}
          onSourceFailure={() => {}}
          onUpNext={() => {}}
        />
      </CoreContext.Provider>,
    );
  },
};
declare global {
  interface Window {
    kinoTrackProbe: typeof probe;
  }
}
window.kinoTrackProbe = probe;
const native = await connectNativePlayer();
native!.playerEvent.connect((name, payload) => {
  if (name !== 'time') {
    probe.events.push({ name, payload });
    probe.events = probe.events.slice(-50);
  }
  if (name === 'ready') probe.ready = true;
  if (name === 'audioTracks') probe.audio = payload.items as typeof probe.audio;
  if (name === 'subtitleTracks') probe.subtitles = payload.items as typeof probe.subtitles;
});
probe.connected = true;
