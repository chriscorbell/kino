import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { BoardState, CoreRuntimeEvent } from '../core/types';
import { SearchScreen } from './SearchScreen';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  let state: BoardState = { catalogs: [], selected: null };
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const requests: string[] = [];
  const publish = () =>
    listeners.forEach((listener) => listener({ name: 'NewState', args: ['search'] }));
  const target: CoreTransport = {
    destroy: async () => {},
    flush: async () => {},
    prepareClose: async () => {},
    init: async () => {},
    onBeforeDestroy: () => () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: async <State,>() => state as State,
    dispatch: vi.fn(async (action) => {
      if (action.action === 'Load') {
        const args = action.args as { args: { extra: Array<[string, string]> } };
        state = {
          selected: args.args,
          catalogs: ['one', 'two', 'three'].map((id) => ({
            addon: { manifest: { id, name: id } },
            id,
            name: id,
            type: 'movie',
            content: null,
          })),
        };
      } else if (action.action === 'CatalogsWithExtra') {
        const query = state.selected?.extra[0]?.[1];
        state.catalogs.forEach((catalog) => requests.push(`${catalog.id}:${query}`));
      } else if (action.action === 'Unload') {
        state = { selected: null, catalogs: [] };
      }
    }),
  };
  const view = render(
    <CoreContext.Provider
      value={{
        transport: target,
        session: 'guest',
        status: 'ready',
        error: null,
        selectSession: vi.fn(),
      }}
    >
      <SearchScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  return {
    ...view,
    requests,
    target,
    finish(query: string) {
      state = {
        selected: { extra: [['search', query]] },
        catalogs: [
          {
            addon: { manifest: { id: 'one', name: 'one' } },
            id: 'one',
            name: 'one',
            type: 'movie',
            content: {
              type: 'Ready',
              content: [
                {
                  id: query,
                  name: `${query} result`,
                  type: 'movie',
                  inLibrary: false,
                  watched: false,
                },
              ],
            },
          },
        ],
      };
      publish();
    },
  };
}

async function type(value: string, elapsed = 100) {
  fireEvent.change(screen.getByRole('searchbox'), { target: { value } });
  await act(async () => vi.advanceTimersByTimeAsync(elapsed));
}

it('waits for a pause in typing before loading three search providers', async () => {
  const { requests } = setup();
  for (const value of ['m', 'ma', 'mat', 'matr', 'matri', 'matrix']) await type(value);
  expect(requests).toEqual([]);
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(requests).toEqual(['one:matrix', 'two:matrix', 'three:matrix']);
  await type(' matrix ', 500);
  expect(requests).toHaveLength(3);
});

it('submits immediately and cancels the trailing timer and empty searches', async () => {
  const { requests } = setup();
  await type('matrix');
  await act(async () => fireEvent.submit(screen.getByRole('search')));
  expect(requests).toHaveLength(3);
  await act(async () => vi.advanceTimersByTimeAsync(500));
  await act(async () => fireEvent.submit(screen.getByRole('search')));
  expect(requests).toHaveLength(3);
  await type('unfinished');
  await type('   ', 500);
  expect(requests).toHaveLength(3);
});

it('hides superseded results and ignores late responses after the query changes', async () => {
  const fixture = setup();
  await type('old', 300);
  await act(async () => fixture.finish('old'));
  expect(screen.getByText('old result')).toBeInTheDocument();
  await type('final');
  expect(screen.queryByText('old result')).not.toBeInTheDocument();
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => fixture.finish('old'));
  expect(screen.queryByText('old result')).not.toBeInTheDocument();
  await act(async () => fixture.finish('final'));
  expect(screen.getByText('final result')).toBeInTheDocument();
  await type('');
  expect(screen.queryByText('final result')).not.toBeInTheDocument();
});

it('cancels pending typing when leaving Search', async () => {
  const fixture = setup();
  await type('matrix');
  fixture.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(fixture.requests).toEqual([]);
});
