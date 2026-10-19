import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { sources } from './test/messagePaths';

const stylesheets = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' }).filter(
  (path) => path.endsWith('.css') && path !== 'global.css',
);

// Hand-kept selector lists missed new animations: #18 and #97 fixed misses, and the profile
// button's transition was still unlisted when the rule in global.css replaced them.
it('leaves reduced motion to the one rule in global.css', () => {
  expect(stylesheets).not.toEqual([]);
  expect(
    stylesheets.filter((path) =>
      readFileSync(join(import.meta.dirname, path), 'utf8').includes('prefers-reduced-motion'),
    ),
    'global.css already stops every animation and transition; delete these reduced-motion rules',
  ).toEqual([]);
});

// The rule reaches only CSS, and the animations and transitions it stops fire no events.
it('keeps motion where the reduced-motion rule reaches it', () => {
  const motion =
    /\.animate\(|behavior: ?['"]smooth|(?:animation|transition)(?:start|end|iteration|run|cancel)\b/i;
  expect(Object.keys(sources)).not.toEqual([]);
  expect(
    Object.entries(sources)
      .filter(([, source]) => motion.test(source))
      .map(([path]) => path),
    'animate in CSS, which global.css stops under reduced motion, and wait for no animation or transition event',
  ).toEqual([]);
});
