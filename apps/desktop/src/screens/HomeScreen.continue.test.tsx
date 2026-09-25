import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { ContinueWatchingItem } from '../core/types';
import { profile } from '../test/coreState';
import { HomeScreen } from './HomeScreen';

function saved(item: Partial<ContinueWatchingItem> & Pick<ContinueWatchingItem, 'id'>) {
  return {
    name: item.id,
    poster: null,
    posterShape: 'poster',
    progress: 40,
    rememberedSource: null,
    type: 'series',
    videoId: null,
    ...item,
  } satisfies ContinueWatchingItem;
}

it('labels a saved episode on its Continue Watching card', async () => {
  const items = [
    saved({ id: 'tt0903747', name: 'Breaking Bad', videoId: 'tt0903747:2:5' }),
    saved({ id: 'kino-show', name: 'Own ids', videoId: 'kino-show:episode-4' }),
    saved({ id: 'tt0012349', name: 'The Kid', type: 'movie', videoId: 'tt0012349' }),
  ];
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
          ? { items }
          : { catalogs: [], selected: null }) as CoreTransport['getState'],
    subscribe: () => () => {},
  };
  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <HomeScreen onOpen={vi.fn()} />
    </CoreContext.Provider>,
  );
  const episode = await screen.findByRole('button', {
    name: 'Resume Breaking Bad, Season 2, Episode 5',
  });
  expect(episode).toHaveTextContent('S2 E5');
  expect(screen.getByRole('button', { name: 'Resume Own ids' })).not.toHaveTextContent(/S\d/);
  expect(screen.getByRole('button', { name: 'Resume The Kid' })).not.toHaveTextContent(/S\d/);
});
