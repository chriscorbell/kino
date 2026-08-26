import { describe, expect, it } from 'vitest';

import { catalogRequestFromDeepLink, catalogRequestKey } from './catalog';

const manifest = 'https://v3-cinemeta.strem.io/manifest.json';
const encoded = encodeURIComponent(manifest);

describe('catalog deep links', () => {
  it('parses a catalog selection without filters', () => {
    expect(catalogRequestFromDeepLink(`#/discover/${encoded}/movie/top?`)).toEqual({
      base: manifest,
      path: { extra: [], id: 'top', resource: 'catalog', type: 'movie' },
    });
  });

  it('keeps filter values from the query string', () => {
    const request = catalogRequestFromDeepLink(`#/discover/${encoded}/movie/year?genre=Sci-Fi`);
    expect(request?.path.extra).toEqual([['genre', 'Sci-Fi']]);
    expect(request?.path.id).toBe('year');
  });

  it('rejects links that are not catalog selections', () => {
    expect(catalogRequestFromDeepLink(undefined)).toBeNull();
    expect(catalogRequestFromDeepLink('#/detail/movie/tt123')).toBeNull();
    expect(catalogRequestFromDeepLink(`#/discover/${encoded}/movie`)).toBeNull();
  });

  it('keys distinct selections distinctly', () => {
    const popular = catalogRequestFromDeepLink(`#/discover/${encoded}/movie/top?`);
    const comedy = catalogRequestFromDeepLink(`#/discover/${encoded}/movie/top?genre=Comedy`);
    expect(catalogRequestKey(popular)).not.toBe(catalogRequestKey(comedy));
    expect(catalogRequestKey(null)).toBe('default');
  });
});
