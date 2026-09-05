import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { App } from './App';
import { CoreContext } from './core/context';
import type { CoreTransport } from './core/transport';
import type { CatalogRequest, CoreRuntimeEvent, LibraryRequest } from './core/types';
import { metaItem, profile } from './test/coreState';

function fixture() {
  let query = '';
  let genre = '';
  let libraryType: string | null = null;
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const item = metaItem({ id: 'silo', name: 'Silo', type: 'movie' });
  const addon = {
    manifest: { id: 'test', logo: null, name: 'Test' },
    transportUrl: 'https://addon.invalid/manifest.json',
  };
  const catalogRequest = (value: string): CatalogRequest => ({
    base: addon.transportUrl,
    path: {
      resource: 'catalog',
      type: 'movie',
      id: 'top',
      extra: value ? [['genre', value]] : [],
    },
  });
  const dispatch = vi.fn<CoreTransport['dispatch']>().mockImplementation(async (action, model) => {
    if (model === 'search' && action.action === 'Load')
      query = (action.args as { args: { extra: string[][] } }).args.extra[0]?.[1] ?? '';
    if (model === 'discover' && action.action === 'Load') {
      const args = action.args as { args: { request: CatalogRequest } | null };
      genre = args.args?.request.path.extra.find(([name]) => name === 'genre')?.[1] ?? '';
    }
    if (model === 'library' && action.action === 'Load')
      libraryType = (action.args as { args: { request: LibraryRequest } }).args.request.type;
  });
  const transport: CoreTransport = {
    init: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    getState: (async (model: string) =>
      model === 'ctx'
        ? profile()
        : model === 'continue_watching_preview'
          ? { items: [] }
          : model === 'search'
            ? {
                selected: { extra: [['search', query]], type: null },
                catalogs: query
                  ? [
                      {
                        addon,
                        id: 'top',
                        name: 'Top',
                        type: 'movie',
                        content: { type: 'Ready', content: [item] },
                      },
                    ]
                  : [],
              }
            : model === 'meta_details'
              ? {
                  libraryItem: null,
                  title: null,
                  metaItem: { addon, content: { type: 'Ready', content: item } },
                  streams: [],
                  selected: {
                    guessStream: true,
                    metaPath: { resource: 'meta', type: 'movie', id: 'silo', extra: [] },
                    streamPath: { resource: 'stream', type: 'movie', id: 'silo', extra: [] },
                  },
                }
              : model === 'discover'
                ? {
                    catalog: { content: { type: 'Ready', content: [item] } },
                    selected: { request: catalogRequest(genre) },
                    selectable: {
                      nextPage: false,
                      types: [],
                      catalogs: [
                        {
                          addon,
                          id: 'top',
                          name: 'Top',
                          request: catalogRequest(''),
                          selected: true,
                        },
                      ],
                      extra: [
                        {
                          name: 'genre',
                          isRequired: false,
                          options: ['', 'Drama'].map((value) => ({
                            value: value || null,
                            selected: genre === value,
                            request: catalogRequest(value),
                          })),
                        },
                      ],
                    },
                  }
                : model === 'library'
                  ? {
                      catalog: [
                        {
                          id: item.id,
                          name: item.name,
                          poster: null,
                          posterShape: 'poster',
                          progress: 0,
                          type: item.type,
                        },
                      ],
                      selected: { request: { page: 1, sort: 'lastwatched', type: libraryType } },
                      selectable: {
                        nextPage: false,
                        sorts: [],
                        types: [null, 'movie'].map((type) => ({
                          request: { page: 1, sort: 'lastwatched', type },
                          selected: type === libraryType,
                          type,
                        })),
                      },
                    }
                  : { catalogs: [], selected: null }) as CoreTransport['getState'],
  };
  render(
    <CoreContext.Provider
      value={{ transport, status: 'ready', error: null, session: 'guest', selectSession: vi.fn() }}
    >
      <App />
    </CoreContext.Provider>,
  );
  return {
    dispatch,
    async publish() {
      await act(async () => {
        listeners.forEach((listener) =>
          listener({ name: 'NewState', args: ['ctx', 'meta_details', 'search'] }),
        );
      });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

it.each(['Discover', 'Library'])(
  'preserves the selected %s filter and results on Back',
  async (route) => {
    const { dispatch } = fixture();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: route }));
    if (route === 'Discover')
      await user.selectOptions(await screen.findByRole('combobox', { name: 'Genre' }), '1');
    else await user.click(await screen.findByRole('button', { name: 'Movie' }));
    await waitFor(() => {
      if (route === 'Discover')
        expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('1');
      else
        expect(screen.getByRole('button', { name: 'Movie' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
    });
    const card = screen.getByRole('button', { name: /Silo/ });
    const before = dispatch.mock.calls.filter(([, model]) => model === route.toLowerCase()).length;
    await user.click(card);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: /Silo/ })).toBe(card);
    expect(card).toHaveFocus();
    if (route === 'Discover')
      expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('1');
    else
      expect(screen.getByRole('button', { name: 'Movie' })).toHaveAttribute('aria-pressed', 'true');
    expect(dispatch.mock.calls.filter(([, model]) => model === route.toLowerCase())).toHaveLength(
      before,
    );
  },
);

it('restores the query, results, scroll and originating card focus without reloading search', async () => {
  const { dispatch } = fixture();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  const input = screen.getByRole('searchbox');
  await user.type(input, 'Silo');
  fireEvent.submit(input.closest('form')!);
  const card = await screen.findByRole('button', { name: /Silo/ });
  const main = screen.getByRole('main');
  main.scrollTop = 640;
  const before = dispatch.mock.calls.filter(([, model]) => model === 'search').length;
  await user.click(card);
  expect(screen.getByRole('heading', { name: 'Silo' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute('aria-current', 'page');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('searchbox')).toHaveValue('Silo');
  expect(screen.getByRole('button', { name: /Silo/ })).toBe(card);
  expect(card).toHaveFocus();
  expect(screen.getByRole('main').scrollTop).toBe(640);
  expect(dispatch.mock.calls.filter(([, model]) => model === 'search')).toHaveLength(before);
});

it('moves focus with navigation and skip, then leaves it alone during background updates', async () => {
  const { publish } = fixture();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toHaveFocus();
  await user.click(screen.getByRole('link', { name: 'Skip to content' }));
  expect(screen.getByRole('main')).toHaveFocus();
  const control = screen.getByRole('switch', { name: 'Skip intro button' });
  control.focus();
  await publish();
  expect(control).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Search' }));
  const input = screen.getByRole('searchbox');
  await user.type(input, 'Silo');
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(screen.getByRole('button', { name: /Silo/ })).toBeInTheDocument());
  await publish();
  expect(input).toHaveFocus();
});
