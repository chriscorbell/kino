import { describe, expect, it } from 'vitest';

import { resolveLocaleTag } from './index';

describe('locale resolution', () => {
  it('matches an exact locale tag', () => {
    expect(resolveLocaleTag(['en-US'])).toBe('en-US');
  });

  it('matches on language when the region differs', () => {
    expect(resolveLocaleTag(['en-GB'])).toBe('en-US');
  });

  it('falls back when no locale is translated yet', () => {
    expect(resolveLocaleTag(['de-DE', 'fr-FR'])).toBe('en-US');
    expect(resolveLocaleTag([])).toBe('en-US');
  });

  it('prefers the earliest supported entry', () => {
    expect(resolveLocaleTag(['de-DE', 'en-AU'])).toBe('en-US');
  });
});
