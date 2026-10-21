import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { PlaybackSelection } from '../core/actions';
import { useCore } from '../core/context';
import { connectNativePlayer, connectShellReport, nativeShellPresent } from '../native/player';
import { useKinoSettingsStore } from '../useKinoSettings';
import { startPlayback } from './session';
import type { PlaybackDeps, PlaybackEnd, PlaybackSession, PlaybackSnapshot } from './types';

/** The session's current snapshot. The view reads it and owns no playback state. */
export function usePlayback(session: PlaybackSession): PlaybackSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** What a session takes from the shell and the page; the track probe page uses the same. */
export function shellPlaybackDeps(): Pick<
  PlaybackDeps,
  'native' | 'platform' | 'fetch' | 'storage'
> {
  return {
    native: { present: nativeShellPresent(), connect: connectNativePlayer },
    platform: connectShellReport().then((report) => report.platform),
    fetch: (input, init) => fetch(input, init),
    storage: window.localStorage,
  };
}

/**
 * App's playback API: the live session, or null, and `play`, which is ignored
 * while a session is live so a repeated event cannot start two. The handler is
 * read when the outcome arrives, so its identity never matters.
 */
export function usePlaybackHost(
  onFinished: (outcome: PlaybackEnd, selection: PlaybackSelection) => void,
) {
  const { transport } = useCore();
  const settings = useKinoSettingsStore();
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const live = useRef<PlaybackSession | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });

  return {
    session,
    play(selection: PlaybackSelection) {
      if (live.current || !transport) return;
      const started = startPlayback(selection, {
        ...shellPlaybackDeps(),
        core: transport,
        settings,
        onFinished(outcome) {
          live.current = null;
          setSession(null);
          finished.current(outcome, selection);
        },
      });
      live.current = started;
      setSession(started);
    },
  };
}
