import { describe, expect, it } from 'vitest';

import { markerFromCommunity } from './markers';

describe('intro marker trust', () => {
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
