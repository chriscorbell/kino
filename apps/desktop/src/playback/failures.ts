import { t as enUS } from '../locales';
import type { MediaFailure } from './media';

const mediaFailureMessages: Record<MediaFailure, string> = {
  'player-unavailable': enUS.player.playerUnavailable,
  'render-context-unavailable': enUS.player.rendererFailed,
  'hardware-decoding-unavailable': enUS.player.hardwareDecodingFailed,
  'dolby-vision-unsupported': enUS.player.dolbyVisionUnsupported,
  'native-playback-failed': enUS.player.nativePlaybackFailed,
  'browser-start-rejected': enUS.player.startFailed,
  'browser-playback-failed': enUS.player.playbackFailed,
};

/** What the source list says about a source whose media failed. */
export function mediaFailureMessage(failure: MediaFailure) {
  return mediaFailureMessages[failure];
}
