import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { LibraryRequest, LibraryState } from '../core/types';
import { LibraryScreen } from './LibraryScreen';

function mount(target: CoreTransport) {
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
}

const idle = {
  destroy: async () => {},
  flush: async () => {},
  prepareClose: async () => {},
  init: async () => {},
  onBeforeDestroy: () => () => {},
  subscribe: () => () => {},
};

it('uses the requests derived from serialized type options to filter Movies, Series, and All', async () => {
  let request: LibraryRequest = { page: 1, sort: 'lastwatched', type: null };
  const catalog = ['movie', 'series'].map((type) => ({
    id: `kino-${type}`,
    name: `Synthetic ${type}`,
    poster: null,
    posterShape: 'poster' as const,
    progress: 0,
    type,
  }));
  const target: CoreTransport = {
    ...idle,
    dispatch: vi.fn(async (action) => {
      if (action.action !== 'Load') return;
      request = (action.args as { args: { request: LibraryRequest } }).args.request;
    }),
    getState: (async (): Promise<LibraryState> => ({
      selected: { request },
      selectable: {
        nextPage: false,
        sorts: [
          {
            request: { page: 1, sort: 'lastwatched', type: request.type },
            selected: true,
            sort: 'lastwatched',
          },
        ],
        // The adapter derives each option's request from its own value and the
        // selected sort; the screen never sees a Core link.
        types: [null, 'movie', 'series'].map((type) => ({
          request: { page: 1, sort: 'lastwatched', type },
          selected: type === request.type,
          type,
        })),
      },
      catalog: catalog.filter((item) => !request.type || item.type === request.type),
    })) as CoreTransport['getState'],
  };
  mount(target);
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
    ...idle,
    dispatch: vi.fn(async (action) => {
      if (action.action !== 'Load') return;
      const next = (action.args as { args: { request: LibraryRequest } }).args.request;
      if (next.page === 2 && failNext) {
        failNext = false;
        throw new Error('Synthetic page failure');
      }
      request = next;
    }),
    getState: (async (): Promise<LibraryState> => ({
      selected: { request },
      selectable: { nextPage: request.page === 1, types: [], sorts: [] },
      catalog: Array.from({ length: request.page === 1 ? 100 : 125 }, (_, i) => ({
        id: `title-${i}`,
        name: `Saved title ${i + 1}`,
        poster: null,
        posterShape: 'poster' as const,
        progress: 0,
        type: 'movie',
      })),
    })) as CoreTransport['getState'],
  };
  mount(target);
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
