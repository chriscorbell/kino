import { describe, expect, it } from 'vitest';

import { hints, preview, torrentSource, urlSource, video } from '../test/coreState';
import { classifySource, sourceKey } from './sources';
import type { CoreSource } from './types';

const selection = {
  meta: preview({ id: 'show', name: 'Test series', type: 'series' }),
  video: video({ id: 'ep1', title: 'Episode one' }),
};
const transport = 'https://addon.example/manifest.json';

describe('source compatibility', () => {
  it('distinguishes direct, torrent, external, and unsupported sources', () => {
    expect(classifySource({ kind: 'url', url: 'https://example.com/video.mp4' })).toBe('direct');
    expect(classifySource(torrentSource().source)).toBe('torrent');
    expect(classifySource({ kind: 'external', externalUrl: 'https://example.com/watch' })).toBe(
      'external',
    );
    expect(classifySource({ kind: 'youtube', ytId: 'video' })).toBe('unsupported');
    expect(classifySource({ kind: 'url', url: 'http://example.com/video.mp4' })).toBe(
      'unsupported',
    );
  });

  it('keys sources by transport and stream identity', () => {
    expect(sourceKey(urlSource('https://example.com/video.mp4'), transport, selection)).not.toBe(
      sourceKey(urlSource('https://example.com/other.mp4'), transport, selection),
    );
  });

  it('distinguishes pack files, guessed episodes, discovery hints, and destinations', () => {
    const key = (source: CoreSource, current = selection.video) =>
      sourceKey(source, 'https://addon.invalid/manifest.json', { ...selection, video: current });
    expect(key(torrentSource({ fileIdx: 0 }))).not.toBe(key(torrentSource({ fileIdx: 1 })));
    expect(key(torrentSource())).not.toBe(
      key(torrentSource(), video({ id: 'ep2', title: 'Episode two' })),
    );
    expect(key(torrentSource({ infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' }))).toBe(
      key(torrentSource({ infoHash: 'abcdef0123456789abcdef0123456789abcdef01' })),
    );
    // A different swarm hint is a different attempt at the same torrent.
    expect(key(torrentSource({ sources: ['tracker:https://a.invalid/announce'] }))).not.toBe(
      key(torrentSource({ sources: ['tracker:https://b.invalid/announce'] })),
    );
    expect(
      key({
        description: null,
        hints: hints(),
        name: null,
        source: { kind: 'external', externalUrl: 'https://example.invalid/a' },
      }),
    ).not.toBe(
      key({
        description: null,
        hints: hints(),
        name: null,
        source: { kind: 'external', externalUrl: 'https://example.invalid/b' },
      }),
    );
  });

  it('keeps distinct request credentials separate without depending on header order or labels', () => {
    const source = urlSource('https://media.invalid/movie.mp4', {
      hints: hints({
        proxyRequestHeaders: {
          Referer: 'https://addon.invalid/',
          Authorization: 'Bearer synthetic',
        },
      }),
    });
    const key = (candidate: CoreSource) =>
      sourceKey(candidate, 'https://addon.invalid/manifest.json', selection);
    expect(key(source)).toBe(
      key({
        ...source,
        name: 'New label',
        hints: hints({
          proxyRequestHeaders: {
            authorization: 'Bearer synthetic',
            referer: 'https://addon.invalid/',
          },
        }),
      }),
    );
    expect(key(source)).not.toBe(
      key({
        ...source,
        hints: hints({ proxyRequestHeaders: { Authorization: 'Bearer other-synthetic' } }),
      }),
    );
  });
});
