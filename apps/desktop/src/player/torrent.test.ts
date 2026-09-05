import { describe, expect, it } from 'vitest';

import { resolveFileIndex, torrentCreateRequest, torrentMediaUrl } from './torrent';

const base = { deepLinks: { player: 'stremio:///player/value' } };
const engine = 'http://127.0.0.1:11470/kino/test-session-capability';

describe('torrent streaming', () => {
  it('builds a create request with trackers and normalized hash', () => {
    const request = torrentCreateRequest(`${engine}/`, {
      ...base,
      fileIdx: 1,
      infoHash: 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C',
      sources: ['tracker:udp://tracker.example:1337/announce', 'dht:abc'],
    });

    expect(request.createUrl).toBe(`${engine}/dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c/create`);
    expect(request.body.announce).toEqual(['udp://tracker.example:1337/announce']);
    expect(request.body.guessFileIdx).toBe(false);
  });

  it('asks the engine to guess when the source omits a file index', () => {
    const request = torrentCreateRequest(engine, { ...base, infoHash: 'abc' });
    expect(request.body.guessFileIdx).toBe(true);
    expect(request.body.announce).toEqual([]);
  });

  it('prefers the declared file index over a guess', () => {
    expect(resolveFileIndex({ ...base, fileIdx: 2 }, { guessedFileIdx: 5 })).toBe(2);
    expect(resolveFileIndex({ ...base }, { guessedFileIdx: 5 })).toBe(5);
    expect(resolveFileIndex({ ...base }, {})).toBeNull();
  });

  it('builds the media URL the engine serves ranges from', () => {
    expect(torrentMediaUrl(engine, { ...base, infoHash: 'ABC' }, 3)).toBe(`${engine}/abc/3`);
  });
});
