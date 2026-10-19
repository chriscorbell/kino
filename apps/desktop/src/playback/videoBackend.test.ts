import { fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import type { MediaEvent } from './media';
import { videoBackend } from './videoBackend';

function attached() {
  const video = document.createElement('video');
  const backend = videoBackend();
  const events: MediaEvent[] = [];
  backend.subscribe((event) => events.push(event));
  const detach = backend.attach(video);
  const set = (
    property: 'currentTime' | 'duration' | 'volume' | 'muted',
    value: number | boolean,
  ) => Object.defineProperty(video, property, { value, configurable: true });
  return { backend, detach, events, set, video };
}

it('turns media element events into the same MediaEvents the native player sends', () => {
  const { events, set, video } = attached();
  fireEvent(video, new Event('loadstart'));
  set('duration', 120);
  fireEvent.loadedMetadata(video);
  fireEvent.canPlay(video);
  fireEvent.play(video);
  set('currentTime', 30.4996);
  fireEvent.timeUpdate(video);
  set('currentTime', 12);
  fireEvent.seeking(video);
  fireEvent.waiting(video);
  fireEvent.playing(video);
  fireEvent.pause(video);
  fireEvent.ended(video);
  set('volume', 0.65);
  set('muted', true);
  fireEvent.volumeChange(video);
  expect(events).toEqual([
    { type: 'buffering', active: true },
    { type: 'duration', milliseconds: 120000 },
    { type: 'ready' },
    { type: 'buffering', active: false },
    { type: 'paused', paused: false },
    { type: 'time', milliseconds: 30500 },
    { type: 'time', milliseconds: 12000 },
    { type: 'buffering', active: true },
    { type: 'buffering', active: false },
    { type: 'paused', paused: true },
    { type: 'ended' },
    { type: 'volume', percent: 65 },
    { type: 'muted', muted: true },
  ]);
});

it('reads an unknown or endless duration as 0', () => {
  const { events, set, video } = attached();
  set('duration', Number.POSITIVE_INFINITY);
  fireEvent.durationChange(video);
  set('duration', Number.NaN);
  fireEvent.durationChange(video);
  expect(events).toEqual([
    { type: 'duration', milliseconds: 0 },
    { type: 'duration', milliseconds: 0 },
  ]);
});

it('reports how far the element has read ahead of the playhead', () => {
  const { events, set, video } = attached();
  const ranges = [
    [0, 10],
    [20, 150],
  ];
  Object.defineProperty(video, 'buffered', {
    configurable: true,
    value: {
      length: ranges.length,
      start: (index: number) => ranges[index]![0],
      end: (index: number) => ranges[index]![1],
    },
  });
  set('currentTime', 30);
  fireEvent.progress(video);
  expect(events).toEqual([{ type: 'buffered', milliseconds: 150000 }]);
});

it('reports a media error with codes and numbers only', () => {
  const { events, video } = attached();
  Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
  fireEvent.error(video);
  expect(events).toEqual([
    {
      type: 'failed',
      failure: 'browser-playback-failed',
      detail: { code: 4, networkState: video.networkState, readyState: video.readyState },
    },
  ]);
});

it('reports a refused start as a failure', async () => {
  const { backend, events, video } = attached();
  video.play = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  backend.setPaused(false);
  await vi.waitFor(() =>
    expect(events).toEqual([
      { type: 'failed', failure: 'browser-start-rejected', detail: { code: 'NotAllowedError' } },
    ]),
  );
});

it('applies a load that arrived before the element, and stops reporting once detached', () => {
  const video = document.createElement('video');
  const backend = videoBackend();
  const events: MediaEvent[] = [];
  backend.subscribe((event) => events.push(event));
  backend.load({
    url: 'https://media.invalid/fixture.mp4',
    headers: {},
    stereo: false,
    audioLanguage: '',
    matchRefreshRate: false,
  });
  const detach = backend.attach(video);
  expect(video.getAttribute('src')).toBe('https://media.invalid/fixture.mp4');
  detach();
  fireEvent.ended(video);
  expect(events).toEqual([]);
});
