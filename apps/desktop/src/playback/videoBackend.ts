// The browser's <video> as a MediaBackend, for vitest and the web build. It
// attaches the element's media listeners itself and reports them as
// MediaEvent, the same events the native player sends.

import { mediaPosition, type MediaBackend, type MediaEvent } from './media';

export interface VideoBackend extends MediaBackend {
  /**
   * The view lends the element. A load that arrived first is applied on
   * attach. Detaching removes the listeners and nothing else.
   */
  attach(video: HTMLVideoElement): () => void;
}

// A live stream's duration is Infinity and an unloaded one NaN; Kino reads 0
// as unknown.
const toMilliseconds = (seconds: number) =>
  Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0;

function bufferedAhead(video: HTMLVideoElement): MediaEvent[] {
  const { buffered, currentTime } = video;
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= currentTime && currentTime <= buffered.end(index)) {
      return [{ type: 'buffered', milliseconds: toMilliseconds(buffered.end(index)) }];
    }
  }
  return [];
}

const time = (video: HTMLVideoElement): MediaEvent[] => [
  { type: 'time', milliseconds: toMilliseconds(video.currentTime) },
];
const duration = (video: HTMLVideoElement): MediaEvent => ({
  type: 'duration',
  milliseconds: toMilliseconds(video.duration),
});
const buffering = (active: boolean) => (): MediaEvent[] => [{ type: 'buffering', active }];

const domEvents: Record<string, (video: HTMLVideoElement) => MediaEvent[]> = {
  timeupdate: time,
  seeking: time,
  durationchange: (video) => [duration(video)],
  loadedmetadata: (video) => [duration(video), { type: 'ready', paused: video.paused }],
  progress: bufferedAhead,
  play: () => [{ type: 'paused', paused: false }],
  pause: () => [{ type: 'paused', paused: true }],
  loadstart: buffering(true),
  waiting: buffering(true),
  stalled: buffering(true),
  canplay: buffering(false),
  playing: buffering(false),
  ended: () => [{ type: 'ended' }],
  volumechange: (video) => [
    { type: 'volume', percent: video.volume * 100 },
    { type: 'muted', muted: video.muted },
  ],
  error: (video) => [
    {
      type: 'failed',
      failure: 'browser-playback-failed',
      detail: {
        code: video.error?.code ?? 0,
        networkState: video.networkState,
        readyState: video.readyState,
      },
    },
  ],
};

export function videoBackend(): VideoBackend {
  const listeners = new Set<(event: MediaEvent) => void>();
  const emit = (event: MediaEvent) => listeners.forEach((listener) => listener(event));
  let element: HTMLVideoElement | null = null;
  let source: string | null = null;
  const play = (video: HTMLVideoElement) =>
    video.play().catch((error: unknown) =>
      emit({
        type: 'failed',
        failure: 'browser-start-rejected',
        detail: { code: error instanceof DOMException ? error.name : 'UnknownError' },
      }),
    );

  return {
    capabilities: { tracks: false },
    attach(video) {
      element = video;
      if (source !== null && video.getAttribute('src') !== source) video.src = source;
      const detach = Object.entries(domEvents).map(([name, read]) => {
        const onEvent = () => read(video).forEach(emit);
        video.addEventListener(name, onEvent);
        return () => video.removeEventListener(name, onEvent);
      });
      return () => {
        detach.forEach((remove) => remove());
        if (element === video) element = null;
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load({ url }) {
      source = url;
      if (element && element.getAttribute('src') !== url) element.src = url;
    },
    setPaused(paused) {
      if (!element) return;
      if (paused) element.pause();
      else void play(element);
    },
    seek(milliseconds) {
      if (element) element.currentTime = milliseconds / 1000;
    },
    setVolume(percent) {
      if (element) element.volume = percent / 100;
    },
    setMuted(muted) {
      if (element) element.muted = muted;
    },
    setAudioTrack() {},
    setSubtitleTrack() {},
    addSubtitles() {},
    setSubtitleDelay() {},
    setSubtitleStyle() {},
    setMatchRefreshRate() {},
    setNowPlaying() {},
    async freeze() {
      if (!element) return null;
      const position = mediaPosition(
        toMilliseconds(element.currentTime),
        toMilliseconds(element.duration),
      );
      element.pause();
      return position;
    },
    // The element stops when the view removes it. Clearing its source here
    // would make a reload of the same URL start the video over.
    stop() {
      source = null;
    },
  };
}
