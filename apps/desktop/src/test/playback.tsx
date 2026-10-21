import type { ClientPlatform } from '@kino/settings';
import { act, waitFor, type RenderResult } from '@testing-library/react';
import { afterEach, vi, type Mock } from 'vitest';

import type { PlaybackSelection } from '../core/actions';
import type { CoreAction, CoreRuntimeEvent, PlayerState } from '../core/types';
import { startPlayback } from '../playback/session';
import type { PlaybackOutcome, PlayerCorePort } from '../playback/types';
import { PlayerScreen } from '../screens/PlayerScreen';
import type { KinoSettings } from '../settings';
import { createKinoSettingsStore, type KinoSettingsStore } from '../settingsStore';
import { profile } from './coreState';
import { memoryStorage } from './memoryStorage';
import type { FakeNativePlayer } from './nativePlayer';
import { renderWithSettings } from './renderWithSettings';

/** Core's Player model once it resolved the selection's source. */
export function resolvedPlayer(selection: PlaybackSelection): PlayerState {
  return {
    libraryItem: null,
    selected: { stream: selection.stream },
    stream: { type: 'Ready', content: { source: selection.stream.source } },
    subtitles: [],
    title: null,
  };
}

// A session outlives its view by design, and a test never ends one it does not
// exit, so each test's sessions lose their shell when it finishes. Otherwise a
// later test's events would reach them too.
const shells = new Set<FakeNativePlayer>();
afterEach(() => {
  shells.forEach((shell) => shell.disconnectAll());
  shells.clear();
});

export interface MountedPlayback {
  view: RenderResult;
  store: KinoSettingsStore;
  /** Every Player report the session dispatched to Core, in order. */
  reports: Mock<(action: CoreAction, model: 'player') => void>;
  onFinished: Mock<(outcome: PlaybackOutcome) => void>;
  /** Core publishes a new Player snapshot, as after a progress or subtitle update. */
  publish(): Promise<void>;
}

/**
 * Starts a playback session over a fake Core, renders PlayerScreen on it, and
 * resolves once Core has answered the Load. Without `native` the session plays
 * in the browser's `<video>`.
 */
export async function mountPlayback({
  selection,
  native = null,
  player = () => resolvedPlayer(selection),
  core: overrides = {},
  languages = {},
  settings = {},
  storage = memoryStorage(),
  strict = false,
  platform = native ? 'macos' : 'web',
}: {
  selection: PlaybackSelection;
  native?: FakeNativePlayer | null;
  /** Read on every Player state request, so a test can change what Core says. */
  player?: () => PlayerState | null;
  core?: Partial<PlayerCorePort>;
  languages?: { audio?: string; subtitles?: string };
  settings?: Partial<KinoSettings>;
  /** Where Kino settings persist. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  strict?: boolean;
  /** The platform the shell reports, or a promise of it for a shell that has not answered. */
  platform?: ClientPlatform | Promise<ClientPlatform> | undefined;
}): Promise<MountedPlayback> {
  const listeners = new Set<(event: CoreRuntimeEvent) => void>();
  const reports = vi.fn<(action: CoreAction, model: 'player') => void>();
  const core: PlayerCorePort = {
    async dispatch(action, model) {
      if (action.action === 'Player') reports(action, model);
    },
    commit: async () => {},
    getState: (async (model: 'player' | 'ctx') =>
      model === 'ctx'
        ? profile({
            settings: {
              audioLanguage: languages.audio ?? null,
              subtitlesLanguage: languages.subtitles ?? null,
              values: {},
            },
          })
        : player()) as PlayerCorePort['getState'],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onBeforeDestroy: () => () => {},
    ...overrides,
  };
  const store = createKinoSettingsStore(storage);
  store.update(settings);
  const onFinished = vi.fn<(outcome: PlaybackOutcome) => void>();
  if (native) shells.add(native);
  const session = startPlayback(selection, {
    core,
    settings: store,
    native: { present: native !== null, connect: async () => native },
    platform: Promise.resolve(platform),
    fetch: (input, init) => fetch(input, init),
    storage: memoryStorage(),
    onFinished,
  });
  // StrictMode wraps the whole tree, as in main.tsx. Nested inside the settings
  // provider, React 19.2 ran each effect once on first mount, with no practice unmount.
  const view = renderWithSettings(<PlayerScreen session={session} />, {
    store,
    reactStrictMode: strict,
  });
  await waitFor(() => {
    if (session.getSnapshot().waitingFor.core) throw new Error('Core has not answered the Load.');
  });
  return {
    view,
    store,
    reports,
    onFinished,
    publish: () =>
      act(async () => {
        listeners.forEach((listener) => listener({ name: 'NewState', args: ['player'] }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
  };
}
