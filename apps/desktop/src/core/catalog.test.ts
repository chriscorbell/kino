import { describe, expect, it } from 'vitest';

import { catalogRequestKey } from './catalog';

const base = 'https://v3-cinemeta.strem.io/manifest.json';
const request = (extra: Array<[string, string]>) => ({
  base,
  path: { extra, id: 'top', resource: 'catalog', type: 'movie' },
});

describe('catalog selection keys', () => {
  it('keys distinct selections distinctly', () => {
    expect(catalogRequestKey(request([]))).not.toBe(
      catalogRequestKey(request([['genre', 'Comedy']])),
    );
    expect(catalogRequestKey(null)).toBe('default');
  });

  it('keys the same selection identically', () => {
    expect(catalogRequestKey(request([['genre', 'Sci-Fi']]))).toBe(
      catalogRequestKey(request([['genre', 'Sci-Fi']])),
    );
  });
});
