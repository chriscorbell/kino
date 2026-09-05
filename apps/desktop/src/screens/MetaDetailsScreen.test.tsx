import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreMetaItem, CoreRuntimeEvent, MetaDetailsState } from '../core/types';
import { MetaDetailsScreen } from './MetaDetailsScreen';

const meta: CoreMetaItem = {
  id: 'show',
  name: 'Test series',
  type: 'series',
  inLibrary: false,
  watched: false,
  videos: [
    { id: 'ep1', title: 'Episode one', season: 1, episode: 1 },
    { id: 'ep2', title: 'Episode two', season: 1, episode: 2 },
    { id: 'ep3', title: 'Episode three', season: 1, episode: 3 },
  ],
};
const addon = {
  manifest: { id: 'test', name: 'Test add-on' },
  transportUrl: 'https://addon.invalid/manifest.json',
};

// Shape verified against the pinned Core 0.61.0 WASM serializer. The stream
// resources omit their paths; selected identifies the request for this snapshot.
function details(videoId: string, item = meta): MetaDetailsState {
  return {
    libraryItem: null,
    selected: {
      metaPath: { resource: 'meta', type: item.type, id: item.id, extra: [] },
      streamPath: { resource: 'stream', type: item.type, id: videoId, extra: [] },
      guessStream: true,
    },
    metaItem: { addon, content: { type: 'Ready', content: item } },
    streams: [
      {
        addon,
        content: {
          type: 'Ready',
          content: [
            {
              name: `${videoId} source`,
              url: `https://media.invalid/${videoId}.mp4`,
              deepLinks: { player: '' },
            },
          ],
        },
      },
    ],
  };
}

function mountDetails(
  initial = details('ep1'),
  item = meta,
  initialVideoId: string | null = 'ep1',
) {
  let state = initial;
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const dispatch = vi.fn<CoreTransport['dispatch']>().mockResolvedValue(undefined);
  const transport: CoreTransport = {
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    dispatch,
    init: vi.fn().mockResolvedValue(undefined),
    getState: async <State,>() => state as State,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const onPlay = vi.fn();
  render(
    <CoreContext.Provider
      value={{ error: null, status: 'ready', session: 'guest', transport, selectSession: vi.fn() }}
    >
      <MetaDetailsScreen
        item={item}
        initialVideoId={initialVideoId}
        failedSources={new Map()}
        onBack={vi.fn()}
        onPlay={onPlay}
      />
    </CoreContext.Provider>,
  );
  return {
    dispatch,
    onPlay,
    async publish(next: MetaDetailsState) {
      await act(async () => {
        state = next;
        listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
      });
    },
  };
}

describe('episode source identity', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('prevents playing a retained source while the new Load is pending or still returns old state', async () => {
    const { dispatch, onPlay, publish } = mountDetails();
    const firstSource = await screen.findByRole('button', { name: /ep1 source/ });
    expect(firstSource).toBeEnabled();
    let finishLoad!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishLoad = resolve;
    });
    dispatch.mockImplementation((action) =>
      action.action === 'Load' ? pending : Promise.resolve(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    fireEvent.click(firstSource);
    expect(onPlay).not.toHaveBeenCalled();
    expect(firstSource).toBeDisabled();
    expect(screen.getByRole('button', { name: /Episode three/ })).toBeInTheDocument();

    await act(async () => {
      finishLoad();
    });
    fireEvent.click(firstSource);
    expect(onPlay).not.toHaveBeenCalled();
    expect(firstSource).toBeDisabled();

    await publish(details('ep2'));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        video: meta.videos[1],
        stream: expect.objectContaining({ url: 'https://media.invalid/ep2.mp4' }),
      }),
    );
  });

  it('rejects out-of-order snapshots after rapid episode changes', async () => {
    const { onPlay, publish } = mountDetails();
    await screen.findByRole('button', { name: /ep1 source/ });
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    fireEvent.click(screen.getByRole('button', { name: /Episode three/ }));

    await publish(details('ep2'));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /ep2 source/ })).toBeDisabled();

    await publish(details('ep3'));
    expect(screen.getByRole('button', { name: /ep3 source/ })).toBeEnabled();
    await publish(details('ep1'));
    fireEvent.click(screen.getByRole('button', { name: /ep1 source/ }));
    expect(onPlay).not.toHaveBeenCalled();

    await publish(details('ep3'));
    fireEvent.click(screen.getByRole('button', { name: /ep3 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        video: meta.videos[2],
        stream: expect.objectContaining({ url: 'https://media.invalid/ep3.mp4' }),
      }),
    );
  });

  it('keeps guessed movie streams playable and rejects snapshots for a different title', async () => {
    const movie = { ...meta, id: 'movie', type: 'movie', videos: [] };
    const { onPlay, publish } = mountDetails(details('movie', movie), movie, null);
    const source = await screen.findByRole('button', { name: /movie source/ });
    await waitFor(() => expect(source).toBeEnabled());
    fireEvent.click(source);
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ meta: movie, video: null }),
    );
    onPlay.mockClear();
    await publish(details('movie', { ...movie, id: 'another-title' }));
    fireEvent.click(screen.getByRole('button', { name: /movie source/ }));
    expect(onPlay).not.toHaveBeenCalled();
  });
});

describe('Start Over', () => {
  function resumableDetails(videoId: string) {
    return {
      ...details(videoId),
      libraryItem: { _id: meta.id, state: { timeOffset: 30_000, video_id: 'ep2' } },
    };
  }

  it('starts the explicitly selected source over and preserves its episode', async () => {
    const { onPlay } = mountDetails(resumableDetails('ep2'), meta, 'ep2');
    const restart = await screen.findByRole('button', { name: 'Start over' });
    expect(restart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(restart);
    expect(restart).toHaveAttribute('aria-pressed', 'true');
    expect(onPlay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        resumeMode: 'start-over',
        video: meta.videos[1],
        stream: expect.objectContaining({ url: 'https://media.invalid/ep2.mp4' }),
      }),
    );
  });

  it('offers progress only for its episode and resets Start Over after changing episodes', async () => {
    const { onPlay, publish } = mountDetails(resumableDetails('ep1'));
    await screen.findByRole('button', { name: /ep1 source/ });
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    await publish(resumableDetails('ep2'));
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    fireEvent.click(screen.getByRole('button', { name: /Episode three/ }));
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).not.toHaveBeenCalled();
    await publish(resumableDetails('ep3'));
    expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Episode two/ }));
    await publish(resumableDetails('ep2'));
    expect(screen.getByRole('button', { name: 'Start over' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: /ep2 source/ }));
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ resumeMode: 'resume', video: meta.videos[1] }),
    );
  });
});
