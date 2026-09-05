import type { CoreStream } from '../core/types';

// Unknown parameters still let Core discover subtitles by media ID. Only
// forward supplied file metadata; a URL or torrent hash is not a video hash.
export function videoParams(stream: CoreStream) {
  const hints = stream.behaviorHints;
  return {
    hash:
      typeof hints?.videoHash === 'string' && /^[a-f0-9]{16}$/i.test(hints.videoHash)
        ? hints.videoHash
        : null,
    size:
      typeof hints?.videoSize === 'number' &&
      Number.isSafeInteger(hints.videoSize) &&
      hints.videoSize > 0
        ? hints.videoSize
        : null,
    filename: typeof hints?.filename === 'string' && hints.filename.trim() ? hints.filename : null,
  };
}
