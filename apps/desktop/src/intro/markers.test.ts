import { describe, expect, it } from 'vitest';

import { markerFromChapters, markerFromCommunity } from './markers';

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

  it('requires confidence, corroboration, and duration-safe community data', () => {
    const base = {
      durationMs: 80_000,
      endMs: 92_000,
      endsAtMediaEnd: false,
      startMs: 12_000,
      startsAtBeginning: false,
    };
    expect(
      markerFromCommunity(
        [
          { ...base, confidence: 0.95, submissionCount: 1 },
          { ...base, confidence: 0.8, submissionCount: 2 },
        ],
        3_000_000,
      ),
    ).toEqual({ source: 'theintrodb', startMs: 12_000, endMs: 92_000 });
    expect(
      markerFromCommunity([{ ...base, confidence: 0.79, submissionCount: 3 }], 3_000_000),
    ).toBeNull();
  });
});
