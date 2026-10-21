// The one way a playback session ends. Back, Up Next, a source failure, window
// close, Quit and Core teardown all run the exit; none of them knows the steps.
//
// Kept loadable by Node's type stripping, because scripts/check-core-shutdown.mjs
// runs `savePlayback` against the pinned Core: value imports carry `.ts`,
// everything else is `import type`.

import type { ClientPlatform } from '@kino/settings';

import { finalPauseAction, unloadPlayerAction } from '../core/actions.ts';
import { coreStopped, storageTimedOut } from '../core/errors.ts';
import type { MediaPosition } from './media';
import { timeChangedAction } from './progress.ts';
import type { ExitState, PlaybackEnd, PlaybackOutcome, PlayerCorePort } from './types';

interface SaveSteps {
  /** Pauses the player and returns the position to save: its exact one, or the last known. */
  freeze(): Promise<MediaPosition>;
  /** The Load this save follows, so TimeChanged never reaches Core before it. */
  loaded: Promise<unknown>;
  /** Stops the player and everything that reports about it. */
  stop(): void;
  /**
   * The platform the shell reported, which names the device. Null if it never
   * answered, and then nothing played, so there is no position to send.
   */
  platform(): ClientPlatform | null;
}

/**
 * The order PLAYBACK.md promises for every exit: capture the position, send
 * it, commit the final pause, which waits for storage and account sync, stop
 * the player, then commit Unload, which waits for the writes Unload causes.
 * Every step is safe to repeat, so a failed attempt starts again from the top.
 */
export async function savePlayback(
  core: Pick<PlayerCorePort, 'dispatch' | 'commit'>,
  steps: SaveSteps,
): Promise<void> {
  const position = await steps.freeze();
  await steps.loaded.catch(() => undefined);
  const platform = steps.platform();
  const finalTime = platform === null ? null : timeChangedAction(position, platform);
  if (finalTime) await core.dispatch(finalTime, 'player');
  await core.commit(finalPauseAction, 'player');
  steps.stop();
  await core.commit(unloadPlayerAction, 'player');
}

/**
 * Returns the exit. Running it starts the save, or joins the one in flight,
 * whose outcome wins. It resolves once Unload is durable and `onFinished` has
 * run, and after that every run resolves at once. It rejects when the save
 * failed: the state becomes 'save-failed' and the next run starts over. A save
 * that no retry could complete ends instead: one that failed because the Core
 * worker stopped, or one whose Unload failed after the player stopped, since
 * Core has already unloaded and cannot write again what was lost. That exit
 * stops the player, reports its outcome as unsaved, telling an Unload whose
 * writes did not finish in time from one whose writes failed, and every later
 * run rejects at once.
 */
export function createExit({
  core,
  steps,
  onState,
  onFinished,
}: {
  core: Pick<PlayerCorePort, 'dispatch' | 'commit'>;
  steps: SaveSteps;
  onState(state: ExitState): void;
  onFinished(outcome: PlaybackEnd): void;
}): (outcome: PlaybackOutcome) => Promise<void> {
  let running: Promise<void> | null = null;
  return (outcome) => {
    running ??= (async () => {
      onState('saving');
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        steps.stop();
      };
      try {
        await savePlayback(core, { ...steps, stop });
      } catch (error) {
        const unsaved = coreStopped(error)
          ? 'core-stopped'
          : stopped && (storageTimedOut(error) ? 'unload-timed-out' : 'unload-failed');
        if (!unsaved) {
          running = null;
          onState('save-failed');
          throw error;
        }
        console.error('[kino:player] progress not saved', { reason: unsaved });
        stop();
        onFinished({ ...outcome, unsaved });
        throw error;
      }
      onFinished(outcome);
    })();
    return running;
  };
}
