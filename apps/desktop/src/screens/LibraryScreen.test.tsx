import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { LibraryRequest } from '../core/types';
import { LibraryScreen } from './LibraryScreen';

it('uses serialized type options to filter Movies, Series, and All', async () => {
  let request: LibraryRequest = { page: 1, sort: 'lastwatched', type: null };
  const catalog = ['movie', 'series'].map((type) => ({
    _id: `kino-${type}`,
    name: `Synthetic ${type}`,
    type,
    poster: null,
    posterShape: 'poster',
  }));
  const target: CoreTransport = {
    destroy: async () => {},
    flush: async () => {},
    prepareClose: async () => {},
    init: async () => {},
    onBeforeDestroy: () => () => {},
    subscribe: () => () => {},
    dispatch: vi.fn(async (action) => {
      if (action.action !== 'Load') return;
      request = (action.args as { args: { request: LibraryRequest } }).args.request;
    }),
    getState: async <State,>() =>
      ({
        selected: { request },
        selectable: {
          nextPage: false,
          sorts: [
            {
              sort: 'lastwatched',
              selected: true,
              deepLinks: { library: '#/library?sort=lastwatched' },
            },
          ],
          types: [null, 'movie', 'series'].map((type) => ({
            type,
            selected: type === request.type,
            deepLinks: { library: `#/library${type ? `/${type}` : ''}?sort=lastwatched` },
          })),
        },
        catalog: catalog.filter((item) => !request.type || item.type === request.type),
      }) as State,
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
      <LibraryScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  await screen.findByText('Synthetic movie');
  for (const [label, type] of [
    ['Movie', 'movie'],
    ['Series', 'series'],
    ['All', null],
  ] as const) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(request).toEqual({ page: 1, sort: 'lastwatched', type });
    for (const item of catalog) {
      expect(Boolean(screen.queryByText(item.name))).toBe(!type || type === item.type);
    }
  }
});

it('loads entries 101-125, retains visible entries on failure, and retries the same page', async () => {
  let request: LibraryRequest = { page: 1, sort: 'lastwatched', type: null };
  let failNext = true;
  const target: CoreTransport = {
    destroy: async () => {},
    flush: async () => {},
    prepareClose: async () => {},
    init: async () => {},
    onBeforeDestroy: () => () => {},
    subscribe: () => () => {},
    dispatch: vi.fn(async (action) => {
      if (action.action !== 'Load') return;
      const next = (action.args as { args: { request: LibraryRequest } }).args.request;
      if (next.page === 2 && failNext) {
        failNext = false;
        throw new Error('Synthetic page failure');
      }
      request = next;
    }),
    getState: async <State,>() =>
      ({
        selected: { request },
        selectable: { nextPage: request.page === 1, types: [], sorts: [] },
        catalog: Array.from({ length: request.page === 1 ? 100 : 125 }, (_, i) => ({
          _id: `title-${i}`,
          name: `Saved title ${i + 1}`,
          type: 'movie',
        })),
      }) as State,
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
      <LibraryScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  await screen.findByText('Saved title 100');
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Saved title 100')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Saved title 125');
  expect(screen.getAllByRole('button', { name: /Saved title/ })).toHaveLength(125);
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  expect(request.page).toBe(2);
});
