import { useCallback, useEffect, useState, type RefObject } from 'react';

import { t } from '../locales';
import type { NativePlayer } from '../native/player';

export function useFullscreen(
  container: RefObject<HTMLElement | null>,
  nativePlayer: NativePlayer | null,
) {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const changed = () => {
      setFullscreen(
        nativePlayer ? nativePlayer.fullscreen : document.fullscreenElement === container.current,
      );
      setError(null);
    };
    if (nativePlayer) {
      nativePlayer.fullscreenChanged.connect(changed);
      changed();
      return () => nativePlayer.fullscreenChanged.disconnect(changed);
    }
    const failed = () => setError(t.player.fullscreenFailed);
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('fullscreenerror', failed);
    changed();
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('fullscreenerror', failed);
    };
  }, [container, nativePlayer]);

  const change = useCallback(
    async (enabled: boolean) => {
      setError(null);
      try {
        if (nativePlayer) {
          nativePlayer.setFullscreen(enabled);
        } else if (enabled) {
          if (!container.current) return;
          await container.current.requestFullscreen();
        } else if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {
        setError(t.player.fullscreenFailed);
      }
    },
    [container, nativePlayer],
  );

  const toggle = useCallback(() => {
    const current = nativePlayer
      ? nativePlayer.fullscreen
      : document.fullscreenElement === container.current;
    void change(!current);
  }, [change, container, nativePlayer]);
  const exit = useCallback(() => void change(false), [change]);

  return { error, exit, fullscreen, toggle };
}
