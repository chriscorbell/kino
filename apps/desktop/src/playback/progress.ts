// What Core hears about playback while it runs. The only module that builds
// Player progress reports, so both media backends report the same way.
//
// Kept loadable by Node's type stripping for the Core gates: value imports
// carry `.ts`, everything else is `import type`, and nothing here may use Vite
// syntax or import the locales.

import type { ClientPlatform } from '@kino/settings';

import { playerAction } from '../core/actions.ts';
import type { TransientAction } from '../core/writes';
import type { videoParams } from '../player/videoParams';
import { mediaPosition, type MediaPosition } from './media.ts';
import type { PlayerCorePort } from './types';

/** Core stores progress this often while playing, and after any backwards jump. */
const progressIntervalMs = 5_000;

type VideoParams = ReturnType<typeof videoParams>;

/**
 * Policy for the reports of one load. Each method decides whether Core needs
 * to hear about the change and dispatches if so. A position whose duration is
 * still unknown is never reported.
 */
export interface ProgressReporter {
  /** TimeChanged every `progressIntervalMs` of media time, or after the time goes backwards. */
  time(position: MediaPosition): void;
  /** Seek, so Core moves a stored offset backwards too. */
  seek(position: MediaPosition): void;
  /** On pause, TimeChanged then PausedChanged, so the stored offset is the exact pause point. */
  paused(paused: boolean, position: MediaPosition): void;
  /** TimeChanged then Ended. */
  ended(position: MediaPosition): void;
  /** VideoParamsChanged once per load, so Core asks add-ons for subtitles (7b5608b, #102). */
  mediaReady(params: VideoParams): void;
}

/** The device name a report carries: the platform the client plays on. */
export const playbackDevice = (platform: ClientPlatform) => `kino-${platform}`;

/** TimeChanged for a position, or null while its duration is unknown, which Core cannot store. */
export function timeChangedAction(
  position: MediaPosition,
  platform: ClientPlatform,
): TransientAction | null {
  const known = mediaPosition(position.time, position.duration);
  return known ? playerAction('TimeChanged', { ...known, device: playbackDevice(platform) }) : null;
}

export function createProgressReporter(
  core: Pick<PlayerCorePort, 'dispatch'>,
  platform: ClientPlatform,
): ProgressReporter {
  const device = playbackDevice(platform);
  let lastReported = 0;
  let mediaReported = false;
  const send = (action: TransientAction) => {
    void core.dispatch(action, 'player').catch((error: unknown) => {
      console.error(
        '[kino:player] progress update failed',
        error instanceof Error ? error.message : error,
      );
    });
  };
  const reportTime = (position: MediaPosition) => {
    const action = timeChangedAction(position, platform);
    if (action) send(action);
  };

  return {
    time(position) {
      const elapsed = position.time - lastReported;
      if (elapsed >= 0 && elapsed < progressIntervalMs) return;
      lastReported = position.time;
      reportTime(position);
    },
    seek(position) {
      const known = mediaPosition(position.time, position.duration);
      if (known) send(playerAction('Seek', { ...known, device }));
    },
    paused(paused, position) {
      if (paused) reportTime(position);
      send(playerAction('PausedChanged', { paused }));
    },
    ended(position) {
      reportTime(position);
      send(playerAction('Ended'));
    },
    mediaReady(params) {
      if (mediaReported) return;
      mediaReported = true;
      send(playerAction('VideoParamsChanged', { videoParams: params }));
    },
  };
}
