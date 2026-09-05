import { useState } from 'react';

import type { Loadable } from './types';

export interface ResourceInput<Value> {
  id: string;
  name: string;
  content: Loadable<Value> | null;
}

interface Snapshot<Value> {
  scope: unknown;
  key: string | null;
  resources: readonly ResourceInput<Value>[] | null;
  known: readonly ResourceInput<Value>[] | null;
  values: Map<string, Value>;
}

function remember<Value>(
  scope: unknown,
  key: string | null,
  resources: readonly ResourceInput<Value>[] | null,
  previous?: Snapshot<Value>,
): Snapshot<Value> {
  const sameSelection = previous?.scope === scope && previous?.key === key;
  const known = resources ?? (sameSelection ? previous!.known : null);
  const values = new Map<string, Value>();
  for (const resource of known ?? []) {
    if (resources && resource.content?.type === 'Ready') {
      values.set(resource.id, resource.content.content);
    } else if (sameSelection && previous!.values.has(resource.id)) {
      values.set(resource.id, previous!.values.get(resource.id)!);
    }
  }
  return { scope, key, resources, known, values };
}

// Keep successful responses visible during a retry, while preserving the actual
// request status. In particular, retained sources are never marked current.
export function useResourceStates<Value>(
  scope: unknown,
  key: string | null,
  resources: readonly ResourceInput<Value>[] | null,
  reloading: boolean,
) {
  const [previous, setPrevious] = useState(() => remember(scope, key, resources));
  // Core can temporarily clear its selected path while reloading metadata.
  const resolvedKey = key ?? (previous.scope === scope ? previous.key : null);
  let current = previous;
  if (
    previous.scope !== scope ||
    previous.key !== resolvedKey ||
    previous.resources !== resources
  ) {
    current = remember(scope, resolvedKey, resources, previous);
    setPrevious(current);
  }
  const rows = (resources ?? current.known ?? []).map((resource) => ({
    ...resource,
    value: current.values.get(resource.id) ?? null,
    current: !reloading && resources !== null && resource.content?.type === 'Ready',
  }));
  return {
    rows,
    pending:
      reloading ||
      resources === null ||
      resources.some((resource) => !resource.content || resource.content.type === 'Loading'),
    failures:
      resources
        ?.filter((resource) => resource.content?.type === 'Err')
        .map((resource) => resource.name) ?? [],
  };
}
