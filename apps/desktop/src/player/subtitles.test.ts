import { describe, expect, it } from 'vitest';

import {
  labelAddonSubtitles,
  labelSubtitleTracks,
  languagesMatch,
  parseSubtitleTracks,
  preferredSubtitleTrack,
  subtitleTrackLabel,
} from './subtitles';

describe('subtitle tracks', () => {
  it('retains supplied titles that distinguish same-language subtitle variants', () => {
    const tracks = parseSubtitleTracks([
      { id: 1, lang: 'eng', codec: 'subrip', title: 'English SDH' },
      { id: 2, lang: 'eng', codec: 'subrip', title: 'English Forced' },
    ]);
    const labels = tracks.map(subtitleTrackLabel);
    expect(labels[0]).toContain('SDH');
    expect(labels[1]).toContain('Forced');
    expect(labels[0]).not.toBe(labels[1]);
    for (const label of labels) {
      expect(label).toContain('English');
      expect(label).toContain('SRT');
    }
  });

  it('identifies native variant flags when the track has no title', () => {
    const tracks = parseSubtitleTracks([
      { id: 1, lang: 'eng', codec: 'subrip', forced: true },
      { id: 2, lang: 'eng', codec: 'subrip', hearingImpaired: true },
    ]);
    expect(subtitleTrackLabel(tracks[0]!)).toContain('Forced');
    expect(subtitleTrackLabel(tracks[1]!)).toContain('SDH');
  });

  it('adds stable track IDs when the remaining labels match', () => {
    const tracks = parseSubtitleTracks([
      { id: 4, lang: 'eng', codec: 'subrip', title: 'Full dialogue' },
      { id: 7, lang: 'eng', codec: 'subrip', title: 'Full dialogue' },
    ]);
    const labeled = labelSubtitleTracks(tracks);
    expect(labeled[0]?.label).toBe('English · Full dialogue · SRT · Track 4');
    expect(labeled[1]?.label).toBe('English · Full dialogue · SRT · Track 7');
    expect(labelSubtitleTracks([...tracks].reverse()).map(({ label }) => label)).toEqual(
      labeled.map(({ label }) => label).reverse(),
    );
  });

  it('does not repeat the language or variant already in the title', () => {
    const tracks = parseSubtitleTracks([
      { id: 1, lang: 'eng', codec: 'subrip', title: 'English SDH', hearingImpaired: true },
      { id: 2, lang: 'eng', codec: 'subrip', title: 'English (Forced)', forced: true },
      { id: 3, lang: 'eng', title: 'eng' },
      { id: 4, lang: 'English', title: 'English' },
      { id: 5, lang: '  ', title: '  ' },
    ]);
    expect(tracks.map(subtitleTrackLabel)).toEqual([
      'English SDH · SRT',
      'English (Forced) · SRT',
      'English',
      'English',
      'Track 5',
    ]);
  });

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
});

describe('add-on subtitle labels', () => {
  it('numbers repeats so identical languages stay tellable apart', () => {
    // The Core adapter validates and filters these; see adapters.test.ts.
    const subtitles = [
      { id: 'a', lang: 'eng', url: 'https://s.example/a.srt' },
      { id: 'b', lang: 'eng', url: 'https://s.example/b.srt' },
      { id: 'c', lang: 'spa', url: 'https://s.example/c.srt' },
      { id: 'd', lang: 'eng', url: 'https://s.example/d.srt' },
    ];

    expect(labelAddonSubtitles(subtitles).map((entry) => entry.label)).toEqual([
      'English',
      'English 2',
      'Spanish',
      'English 3',
    ]);
  });
});
