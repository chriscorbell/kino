import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { CoreContext } from '../core/context';
import type { CoreTransport } from '../core/transport';
import type { CoreRuntimeEvent } from '../core/types';
import { profile } from '../test/coreState';
import { defaultSettings } from '../settings';
import { HomeScreen } from './HomeScreen';
import { SettingsScreen } from './SettingsScreen';

function fixture() {
  let currentProfile = profile({
    settings: {
      audioLanguage: 'eng',
      subtitlesLanguage: 'eng',
      values: { audioLanguage: 'eng', subtitlesLanguage: 'eng' },
    },
  });
  let dismissed = false;
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const target: CoreTransport = {
    init: vi.fn(),
    destroy: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    prepareClose: vi.fn(),
    onBeforeDestroy: () => () => {},
    dispatch: vi.fn().mockResolvedValue(undefined),
    getState: (async (model: string) =>
      model === 'ctx'
        ? currentProfile
        : model === 'continue_watching_preview'
          ? {
              items: dismissed
                ? []
                : [
                    {
                      id: 'saved',
                      name: 'Saved title',
                      type: 'movie',
                      poster: null,
                      posterShape: 'poster',
                      progress: 30,
                      videoId: 'saved',
                    },
                  ],
            }
          : { catalogs: [], selected: null }) as CoreTransport['getState'],
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    target,
    render(child: React.ReactNode) {
      return render(
        <CoreContext.Provider
          value={{
            error: null,
            status: 'ready',
            session: 'guest',
            transport: target,
            selectSession: () => {},
          }}
        >
          {child}
        </CoreContext.Provider>,
      );
    },
    setProfile(value: typeof currentProfile) {
      currentProfile = value;
    },
    dismiss() {
      dismissed = true;
      listeners.forEach((listener) =>
        listener({ name: 'NewState', args: ['continue_watching_preview'] }),
      );
    },
  };
}

it('keeps failed Continue Watching dismissal retryable and announces success after the item disappears', async () => {
  const test = fixture();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  vi.mocked(test.target.dispatch).mockImplementation((action) =>
    action.action === 'Ctx' ? pending : Promise.resolve(),
  );
  test.render(<HomeScreen onOpen={vi.fn()} />);
  const dismiss = await screen.findByRole('button', {
    name: 'Remove from Continue Watching Saved title',
  });
  fireEvent.click(dismiss);
  fireEvent.click(dismiss);
  expect(dismiss).toBeDisabled();
  expect(
    vi.mocked(test.target.dispatch).mock.calls.filter(([action]) => action.action === 'Ctx'),
  ).toHaveLength(1);
  await act(async () => reject(new Error('Synthetic write failure')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Saved title could not be removed');
  expect(dismiss).toBeEnabled();
  vi.mocked(test.target.dispatch).mockImplementation(async (action) => {
    if (action.action === 'Ctx') test.dismiss();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saved title was removed from Continue Watching.',
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'Remove from Continue Watching Saved title' }),
  ).not.toBeInTheDocument();
  expect(test.target.flush).toHaveBeenCalledOnce();
});

it('retries the chosen language with current profile settings and blocks concurrent replacements', async () => {
  const test = fixture();
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  vi.mocked(test.target.dispatch).mockImplementation((action) =>
    action.action === 'Ctx' ? pending : Promise.resolve(),
  );
  test.render(<SettingsScreen settings={defaultSettings} onChange={vi.fn()} />);
  const audio = screen.getByRole('combobox', { name: /Audio language/ });
  const subtitles = screen.getByRole('combobox', { name: /Subtitle language/ });
  await waitFor(() => expect(audio).toBeEnabled());
  fireEvent.change(audio, { target: { value: 'spa' } });
  expect(audio).toBeDisabled();
  expect(subtitles).toBeDisabled();
  await waitFor(() =>
    expect(
      vi.mocked(test.target.dispatch).mock.calls.filter(([action]) => action.action === 'Ctx'),
    ).toHaveLength(1),
  );
  await act(async () => reject(new Error('Synthetic write failure')));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The language preference could not be saved. Try again.',
  );
  expect(audio).toHaveValue('eng');
  test.setProfile(
    profile({
      settings: {
        audioLanguage: 'eng',
        subtitlesLanguage: 'fra',
        values: {
          audioLanguage: 'eng',
          subtitlesLanguage: 'fra',
          streamingServerUrl: 'https://fixture.invalid/',
        },
      },
    }),
  );
  vi.mocked(test.target.dispatch).mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('Language preference saved.'),
  );
  expect(test.target.dispatch).toHaveBeenLastCalledWith({
    action: 'Ctx',
    args: {
      action: 'UpdateSettings',
      args: {
        audioLanguage: 'spa',
        subtitlesLanguage: 'fra',
        streamingServerUrl: 'https://fixture.invalid/',
      },
    },
  });
  expect(audio).toBeEnabled();
  expect(subtitles).toBeEnabled();
});
