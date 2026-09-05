import type { CoreSource } from '../core/types';

// Unknown parameters still let Core discover subtitles by media ID. Only
// forward supplied file metadata; a URL or torrent hash is not a video hash.
export function videoParams(source: CoreSource) {
  const hints = source.hints;
  return {
    hash: hints.videoHash && /^[a-f0-9]{16}$/i.test(hints.videoHash) ? hints.videoHash : null,
    size:
      hints.videoSize !== null && Number.isSafeInteger(hints.videoSize) && hints.videoSize > 0
        ? hints.videoSize
        : null,
    filename: hints.filename?.trim() ? hints.filename : null,
  };
}
