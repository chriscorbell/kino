import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { BoardState, CatalogRequest, CoreCatalog } from '../core/types';
import { preview, profile } from '../test/coreState';
import { HomeScreen } from './HomeScreen';

function catalog(
  addon: string,
  type: string,
  id: string,
  name: string,
  content: CoreCatalog['content'] = {
    type: 'Ready',
    content: [preview({ id: `${addon}-${id}-1`, name: `${name} title`, type })],
  },
): CoreCatalog {
  return {
    addon: { manifest: { id: addon, name: addon } },
    content,
    id,
    name,
    request: {
      base: `https://${addon}.invalid/manifest.json`,
      path: { extra: [], id, resource: 'catalog', type },
    },
    type,
  };
}

function mountHome(board: BoardState) {
  const onDiscover = vi.fn<(request: CatalogRequest) => void>();
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    dispatch: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    getState: (async (model: string) =>
      model === 'ctx'
        ? profile()
        : model === 'continue_watching_preview'
          ? { items: [] }
          : board) as CoreTransport['getState'],
    subscribe: () => () => {},
  };
  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <HomeScreen onDiscover={onDiscover} onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  return { onDiscover };
}

it('gives each movie and series catalog its own named row that opens in Discover', async () => {
  const board: BoardState = {
    selected: null,
    catalogs: [
      catalog('cinemeta', 'movie', 'top', 'Popular'),
      catalog('cinemeta', 'series', 'top', 'Popular'),
      catalog('youtube', 'channel', 'top', 'YouTube'),
      catalog('public', 'movie', 'pd', 'Public Domain Movies'),
      catalog('other', 'movie', 'top', 'Popular'),
      catalog('slow', 'series', 'new', 'New', { type: 'Loading' }),
      catalog('empty', 'movie', 'none', 'Nothing', { type: 'Ready', content: [] }),
    ],
  };
  const { onDiscover } = mountHome(board);
  await screen.findByText('Public Domain Movies title');
  const headings = screen.getAllByRole('heading', { level: 2 });
  expect(headings.map((heading) => heading.textContent)).toEqual([
    'Continue Watching',
    'Popular Movies · cinemeta',
    'Popular Series',
    'Public Domain Movies',
    'Popular Movies · other',
    'New Series',
  ]);
  const series = headings
    .find((heading) => heading.textContent === 'Popular Series')!
    .closest('section')!;
  expect(within(series).getByText('Popular title')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See all Popular Series' }));
  expect(onDiscover).toHaveBeenCalledExactlyOnceWith(board.catalogs[1]!.request);
  // A row still loading holds its place but offers nothing to open yet.
  expect(screen.queryByRole('button', { name: 'See all New Series' })).not.toBeInTheDocument();
});
