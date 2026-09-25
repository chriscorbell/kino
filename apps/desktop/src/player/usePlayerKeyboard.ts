import { useEffect } from 'react';

// Focused controls own Space, arrows, and text entry. In particular the
// timeline's native arrow step must not become a global ten-second seek.
const ownsKeys =
  'button, input, textarea, select, summary, a[href], [contenteditable], ' +
  '[role="menu"], [role="menubar"], [role="menuitem"], [role="listbox"], ' +
  '[role="option"], [role="combobox"], [role="textbox"], [role="slider"], [role="button"]';

/** Space or K, arrows, M, F and Escape, for a player with no focused control. */
export function usePlayerKeyboard({
  hasPlayer,
  currentTime,
  exitFullscreen,
  fullscreen,
  menuOpen,
  onSeek,
  seekTo,
  toggleFullscreen,
  toggleMuted,
  togglePlayback,
  volume,
  changeVolume,
}: {
  hasPlayer: () => boolean;
  currentTime: () => number;
  exitFullscreen: () => void;
  fullscreen: boolean;
  menuOpen: boolean;
  onSeek: () => void;
  seekTo: (milliseconds: number) => void;
  toggleFullscreen: () => void;
  toggleMuted: () => void;
  togglePlayback: () => void;
  volume: number;
  changeVolume: (percent: number) => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.key === 'Escape') {
        if (!menuOpen && fullscreen) {
          event.preventDefault();
          exitFullscreen();
        }
        return;
      }
      if (event.target instanceof Element && event.target.closest(ownsKeys)) return;
      if (!hasPlayer()) return;
      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seekTo(Math.max(0, currentTime() + (event.key === 'ArrowRight' ? 10_000 : -10_000)));
        onSeek();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        changeVolume(volume + (event.key === 'ArrowUp' ? 5 : -5));
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleMuted();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    changeVolume,
    currentTime,
    exitFullscreen,
    fullscreen,
    hasPlayer,
    menuOpen,
    onSeek,
    seekTo,
    toggleFullscreen,
    toggleMuted,
    togglePlayback,
    volume,
  ]);
}
