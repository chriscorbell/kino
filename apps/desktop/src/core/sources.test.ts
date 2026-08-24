import { describe, expect, it } from 'vitest';

import { classifySource, sourceSize } from './sources';

const base = { deepLinks: { player: 'stremio:///player/value' } };

describe('source compatibility', () => {
  it('distinguishes direct, torrent, external, and unsupported sources', () => {
    expect(classifySource({ ...base, url: 'https://example.com/video.mp4' })).toBe('direct');
    expect(classifySource({ ...base, infoHash: 'abc' })).toBe('torrent');
    expect(classifySource({ ...base, externalUrl: 'https://example.com/watch' })).toBe('external');
    expect(classifySource({ ...base, ytId: 'video' })).toBe('unsupported');
  });

  it('formats binary source size without inventing missing metadata', () => {
    expect(sourceSize({ ...base, behaviorHints: { videoSize: 5 * 1024 ** 3 } })).toBe('5.0 GB');
    expect(sourceSize(base)).toBeNull();
  });
});
