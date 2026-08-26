import { describe, expect, it } from 'vitest';

import {
  languagesMatch,
  parseAddonSubtitles,
  parseSubtitleTracks,
  preferredSubtitleTrack,
  subtitleTrackLabel,
} from './subtitles';

describe('subtitle tracks', () => {
  it('keeps only well-formed subtitle track entries', () => {
    expect(
      parseSubtitleTracks([
        { codec: 'subrip', external: false, id: 1, lang: 'eng', selected: true },
        { id: 'two' },
        null,
        { external: true, id: 2, title: 'Signs & Songs' },
      ]),
    ).toEqual([
      { codec: 'subrip', external: false, id: 1, lang: 'eng', selected: true },
      { external: true, id: 2, selected: false, title: 'Signs & Songs' },
    ]);
  });

  it('matches languages across ISO code variants', () => {
    expect(languagesMatch('eng', 'en')).toBe(true);
    expect(languagesMatch('ger', 'de')).toBe(true);
    expect(languagesMatch('eng', 'de')).toBe(false);
    expect(languagesMatch(undefined, 'en')).toBe(false);
  });

  it('prefers the profile language and refuses a wrong-language fallback', () => {
    const tracks = parseSubtitleTracks([
      { id: 1, lang: 'fre' },
      { id: 2, lang: 'eng' },
    ]);

    expect(preferredSubtitleTrack(tracks, 'en')?.id).toBe(2);
    expect(preferredSubtitleTrack(tracks, 'ja')).toBeNull();
    expect(preferredSubtitleTrack(tracks, null)?.id).toBe(1);
    expect(preferredSubtitleTrack([], 'en')).toBeNull();
  });

  it('labels tracks with a readable language and format', () => {
    expect(
      subtitleTrackLabel({ codec: 'subrip', external: false, id: 1, lang: 'eng', selected: false }),
    ).toBe('English · SRT');
    expect(
      subtitleTrackLabel({ external: true, id: 3, selected: false, title: 'Director notes' }),
    ).toBe('Director notes');
    expect(subtitleTrackLabel({ external: false, id: 4, selected: false })).toBe('Track 4');
  });

  it('accepts only HTTPS add-on subtitles', () => {
    expect(
      parseAddonSubtitles([
        { id: 'a', lang: 'eng', url: 'https://subs.example/a.srt' },
        { lang: 'eng', url: 'http://subs.example/insecure.srt' },
        { lang: 'eng' },
        'nonsense',
      ]),
    ).toEqual([{ id: 'a', lang: 'eng', url: 'https://subs.example/a.srt' }]);
  });
});
