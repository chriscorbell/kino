import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CatalogWithFiltersState, CoreRuntimeEvent } from '../core/types';
import { preview } from '../test/coreState';
import { DiscoverScreen } from './DiscoverScreen';

it('distinguishes pending, failed, and empty catalogs and retains titles during retry', async () => {
  const request = {
    base: 'https://fixture.invalid/manifest.json',
    path: { resource: 'catalog', type: 'movie', id: 'test', extra: [] },
  };
  let state: CatalogWithFiltersState = {
    selected: { request },
    catalog: { content: { type: 'Loading' } },
    selectable: {
      types: [],
      extra: [],
      nextPage: false,
      catalogs: [
        {
          id: 'test',
          name: 'Test',
          addon: { manifest: { id: 'test', name: 'Test provider' } },
          request,
          selected: true,
        },
      ],
    },
  };
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const target: CoreTransport = {
    init: vi.fn(),
    destroy: vi.fn(),
    flush: vi.fn(),
    prepareClose: vi.fn(),
    onBeforeDestroy: () => () => {},
    getState: (async () => state) as CoreTransport['getState'],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: vi.fn(async (action) => {
      if (action.action === 'Load') state = { ...state, catalog: { content: { type: 'Loading' } } };
    }),
  };
  const publish = async (content: NonNullable<CatalogWithFiltersState['catalog']>['content']) => {
    await act(async () => {
      state = { ...state, catalog: { content } };
      listeners.forEach((listener) => listener({ name: 'NewState', args: ['discover'] }));
    });
  };
  render(
    <CoreContext.Provider
      value={{
        transport: target,
        session: 'guest',
        status: 'ready',
        error: null,
        selectSession: vi.fn(),
      }}
    >
      <DiscoverScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading catalog'));
  expect(screen.queryByText('This catalog returned no titles.')).not.toBeInTheDocument();
  await publish({ type: 'Ready', content: [preview({ id: 'one', name: 'One title' })] });
  expect(screen.getByText('One title')).toBeVisible();
  await publish({ type: 'Err', content: { kind: 'Env', message: 'Unavailable' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Test provider');
  expect(screen.queryByText('This catalog returned no titles.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry add-ons' }));
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading catalog'));
  expect(screen.getByText('One title')).toBeVisible();
  expect(target.dispatch).toHaveBeenCalledWith({ action: 'Unload' }, 'discover');
  await publish({ type: 'Ready', content: [] });
  expect(screen.getByRole('status')).toHaveTextContent('This catalog returned no titles.');
  expect(screen.queryByText('One title')).not.toBeInTheDocument();
});
