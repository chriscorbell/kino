import { expect, it } from 'vitest';

import { t as enUS } from '../locales';
import { nativeErrorMessage } from './nativeEvents';

it('names why the native player refused a source', () => {
  expect(nativeErrorMessage('dolby-vision-unsupported')).toBe(enUS.player.dolbyVisionUnsupported);
  expect(nativeErrorMessage('hardware-decoding-unavailable')).toBe(
    enUS.player.hardwareDecodingFailed,
  );
  expect(nativeErrorMessage('something-new')).toBe(enUS.player.nativePlaybackFailed);
});
