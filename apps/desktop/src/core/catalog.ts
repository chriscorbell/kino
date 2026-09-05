import type { CatalogRequest } from './types';

export function catalogRequestKey(request: CatalogRequest | null) {
  if (!request) return 'default';
  const { extra, id, type } = request.path;
  return `${request.base}:${type}:${id}:${extra.map((pair) => pair.join('=')).join(',')}`;
}
