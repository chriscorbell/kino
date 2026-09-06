import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { App } from './App';
import type { PlaybackSelection } from './core/actions';
import { CoreContext } from './core/context';
import { checkResumeSource } from './core/resume';
import type { CoreTransport } from './core/transport';
import type { CoreRuntimeEvent } from './core/types';
import { hints, profile, torrentSource, urlSource } from './test/coreState';
import { addon, details, episode, item, remembered } from './test/resumeState';

const played = vi.hoisted(() => vi.fn());
vi.mock('./screens/PlayerScreen', () => ({
  PlayerScreen: ({
    selection,
    onSourceFailure,
  }: {
    selection: PlaybackSelection;
    onSourceFailure: (message: string) => void;
  }) => {
    played(selection);
    return (
      <button onClick={() => onSourceFailure('Synthetic playback failure')}>Fail playback</button>
    );
  },
}));

beforeEach(() => {
  played.mockClear();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});

function mount() {
  let state = details();
  state.streams = [{ addon, content: { type: 'Loading' } }];
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const transport: CoreTransport = {
    destroy: vi.fn(),
    init: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn().mockResolvedValue(undefined),
    onBeforeDestroy: () => () => {},
    getState: (async (model: string) => {
      if (model === 'ctx') return profile();
      if (model === 'continue_watching_preview') return { items: [item] };
      if (model === 'board') return { catalogs: [] };
      return state;
    }) as CoreTransport['getState'],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const app = (target = transport) => (
    <CoreContext.Provider
      value={{
        error: null,
        status: 'ready',
        session: 'guest',
        transport: target,
        selectSession: vi.fn(),
      }}
    >
      <App />
    </CoreContext.Provider>
  );
  const view = render(app());
  return {
    async ready(next = details()) {
      await act(async () => {
        state = next;
        listeners.forEach((listener) => listener({ name: 'NewState', args: ['meta_details'] }));
      });
    },
    changeProfile() {
      view.rerender(app({ ...transport }));
    },
  };
}

it('waits for the remembered add-on and resumes once, returning to selection after failure', async () => {
  const fixture = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Resume Saved series' }));
  expect(screen.getByRole('dialog', { name: 'Loading playback' }).textContent).toBe('');
  expect(played).not.toHaveBeenCalled();
  const ready = details();
  ready.streams.push({
    addon: { ...addon, transportUrl: 'https://slow.invalid/manifest.json' },
    content: { type: 'Loading' },
  });
  await fixture.ready(ready);
  await screen.findByRole('button', { name: 'Fail playback' });
  expect(played).toHaveBeenLastCalledWith(
    expect.objectContaining({
      video: episode,
      stream: remembered,
      streamTransportUrl: addon.transportUrl,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Fail playback' }));
  expect(await screen.findByRole('dialog', { name: 'Saved episode' })).toBeInTheDocument();
  const source = await screen.findByRole('button', { name: /Previous source/ });
  await waitFor(() => expect(source).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Fail playback' })).not.toBeInTheDocument();
  expect(screen.getByText('Synthetic playback failure')).toBeInTheDocument();
});

it('silently offers sources for the saved episode when the remembered URL has changed', async () => {
  const fixture = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Resume Saved series' }));
  const next = details();
  const replacement = urlSource('https://media.invalid/replacement.mp4', {
    name: 'Changed source',
  });
  next.streams = [{ addon, content: { type: 'Ready', content: [replacement] } }];
  await fixture.ready(next);
  const changedSource = await screen.findByRole('button', { name: /Changed source/ });
  await waitFor(() => expect(changedSource).toBeEnabled());
  expect(screen.queryByText(/previous source is unavailable or changed/)).not.toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Saved episode' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start over' })).not.toBeInTheDocument();
  expect(played).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Changed source/ }));
  expect(played).toHaveBeenLastCalledWith(
    expect.objectContaining({ video: episode, stream: replacement }),
  );
});

it.each(['close', 'profile'])(
  'does not start playback after %s cancels a pending check',
  async (cancel) => {
    const fixture = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Saved series' }));
    await screen.findByRole('dialog', { name: 'Loading playback' });
    if (cancel === 'close')
      fireEvent(
        screen.getByRole('dialog', { name: 'Loading playback' }),
        new Event('cancel', { bubbles: true, cancelable: true }),
      );
    else fixture.changeProfile();
    await fixture.ready();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Loading playback' })).not.toBeInTheDocument(),
    );
    expect(played).not.toHaveBeenCalled();
  },
);

it('rejects another add-on, changed request headers, torrent file changes, and unsupported sources', () => {
  const next = details();
  next.streams = [
    {
      addon: { ...addon, transportUrl: 'https://other.invalid/manifest.json' },
      content: { type: 'Ready', content: [remembered] },
    },
  ];
  expect(checkResumeSource(item, next, false, null)).toBe('unavailable');
  const savedTorrent = torrentSource({ fileIdx: 0 });
  const torrentItem = {
    ...item,
    rememberedSource: { stream: savedTorrent, transportUrl: addon.transportUrl },
  };
  next.streams = [{ addon, content: { type: 'Ready', content: [torrentSource({ fileIdx: 1 })] } }];
  expect(checkResumeSource(torrentItem, next, false, null)).toBe('unavailable');
  next.streams = [{ addon, content: { type: 'Ready', content: [savedTorrent] } }];
  expect(checkResumeSource(torrentItem, next, false, null)).toMatchObject({ stream: savedTorrent });
  next.streams = [
    { addon, content: { type: 'Err', content: { message: 'Unavailable', kind: 'provider' } } },
  ];
  expect(checkResumeSource(item, next, false, null)).toBe('unavailable');
  for (const stream of [
    urlSource('https://media.invalid/saved.mp4', {
      hints: hints({ proxyRequestHeaders: { Authorization: 'changed' } }),
    }),
    torrentSource({ fileIdx: 1 }),
    urlSource('http://media.invalid/saved.mp4'),
  ]) {
    expect(
      checkResumeSource(
        { ...item, rememberedSource: { stream, transportUrl: addon.transportUrl } },
        details(),
        false,
        null,
      ),
    ).toBe('unavailable');
  }
  expect(checkResumeSource({ ...item, rememberedSource: null }, details(), false, null)).toBe(
    'unavailable',
  );
});
