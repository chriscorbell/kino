import type { CatalogRequest } from './types';

const DISCOVER_PREFIX = '#/discover/';

// Stremio Core offers catalog selections as deep links rather than raw
// requests, e.g. "#/discover/{encoded manifest url}/movie/top?genre=Comedy".
export function catalogRequestFromDeepLink(link: string | undefined): CatalogRequest | null {
  if (!link?.startsWith(DISCOVER_PREFIX)) return null;

  const [route, query] = link.slice(DISCOVER_PREFIX.length).split('?');
  const segments = route?.split('/') ?? [];
  if (segments.length < 3) return null;

  const [encodedBase, type, id] = segments;
  if (!encodedBase || !type || !id) return null;

  const extra: Array<[string, string]> = [];
  for (const [name, value] of new URLSearchParams(query ?? '')) {
    extra.push([name, value]);
  }

  return {
    base: decodeURIComponent(encodedBase),
    path: {
      extra,
      id: decodeURIComponent(id),
      resource: 'catalog',
      type: decodeURIComponent(type),
    },
  };
}

export function catalogRequestKey(request: CatalogRequest | null) {
  if (!request) return 'default';
  const { extra, id, type } = request.path;
  return `${request.base}:${type}:${id}:${extra.map((pair) => pair.join('=')).join(',')}`;
}
