import { describe, expect, it } from 'vitest';

import { markerFromChapterCues, markerFromChapters, markerFromCommunity } from './markers';

describe('intro marker trust', () => {
  it('prefers an explicitly named chapter with safe bounds', () => {
    expect(
      markerFromChapters([{ title: 'Opening Credits', startMs: 12_000, endMs: 96_000 }], 3_000_000),
    ).toEqual({ source: 'chapter', startMs: 12_000, endMs: 96_000 });
  });

  it('rejects vague chapter names and invalid durations', () => {
    expect(
      markerFromChapters(
        [
          { title: 'Chapter 1', startMs: 0, endMs: 90_000 },
          { title: 'Intro', startMs: 0, endMs: 300_000 },
        ],
        3_000_000,
      ),
    ).toBeNull();
  });

  it('ends a named native chapter at the next chapter cue', () => {
    expect(
      markerFromChapterCues(
        [
          { title: 'Prologue', startMs: 0 },
          { title: 'Intro', startMs: 20_000 },
          { title: '', startMs: 87_000 },
        ],
        2_400_000,
      ),
    ).toEqual({ source: 'chapter', startMs: 20_000, endMs: 87_000 });
  });

  it('trusts a duration-safe community segment and rejects unsafe ones', () => {
    const segment = {
      durationMs: 22_000,
      endMs: 367_458,
      endsAtMediaEnd: false,
      startMs: 345_458,
      startsAtBeginning: false,
    };
    expect(markerFromCommunity([segment], 2_940_000)).toEqual({
      source: 'theintrodb',
      startMs: 345_458,
      endMs: 367_458,
    });
    expect(
      markerFromCommunity(
        [
          { ...segment, endMs: null, endsAtMediaEnd: true },
          { ...segment, endMs: 348_000 },
          { ...segment, endMs: 2_950_000 },
        ],
        2_940_000,
      ),
    ).toBeNull();
  });
});
