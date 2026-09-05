import { describe, expect, it } from 'vitest';

import type { TorrentSource } from './torrent';
import { resolveFileIndex, torrentCreateRequest, torrentMediaUrl } from './torrent';

const engine = 'http://127.0.0.1:11470/kino/test-session-capability';
const torrent = (overrides: Partial<TorrentSource> = {}): TorrentSource => ({
  fileIdx: null,
  infoHash: '0123456789abcdef0123456789abcdef01234567',
  kind: 'torrent',
  sources: [],
  ...overrides,
});

describe('torrent streaming', () => {
  it('builds a create request with trackers and normalized hash', () => {
    const request = torrentCreateRequest(
      `${engine}/`,
      torrent({
        fileIdx: 1,
        infoHash: 'DD8255ECDC7CA55FB0BBF81323D87062DB1F6D1C',
        sources: ['tracker:udp://tracker.example:1337/announce', 'dht:abc'],
      }),
    );

    expect(request.createUrl).toBe(`${engine}/dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c/create`);
    expect(request.body.peerSearch.sources).toEqual(['udp://tracker.example:1337/announce']);
    expect(request.body.guessFileIdx).toBe(false);
  });

  it('asks the engine to guess when the source omits a file index', () => {
    const request = torrentCreateRequest(engine, torrent());
    expect(request.body.guessFileIdx).toBe(true);
    expect(request.body.peerSearch.sources).toEqual([]);
  });

  it('retains bare tracker URLs and removes duplicate or unsupported peer sources', () => {
    const request = torrentCreateRequest(
      engine,
      torrent({
        sources: [
          'https://tracker.invalid/announce?key=synthetic',
          'tracker:https://tracker.invalid/announce?key=synthetic',
          'tracker:',
          'dht:abc',
          'file:///invalid',
        ],
      }),
    );
    expect(request.body.peerSearch.sources).toEqual([
      'https://tracker.invalid/announce?key=synthetic',
    ]);
  });

  it('prefers the declared file index over a guess', () => {
    expect(resolveFileIndex(torrent({ fileIdx: 2 }), { guessedFileIdx: 5 })).toBe(2);
    expect(resolveFileIndex(torrent(), { guessedFileIdx: 5 })).toBe(5);
    expect(resolveFileIndex(torrent(), {})).toBeNull();
  });

  it('builds the media URL the engine serves ranges from', () => {
    expect(
      torrentMediaUrl(engine, torrent({ infoHash: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01' }), 3),
    ).toBe(`${engine}/abcdef0123456789abcdef0123456789abcdef01/3`);
  });
});
