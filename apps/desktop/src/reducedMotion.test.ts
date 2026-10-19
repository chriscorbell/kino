import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const stylesheets = readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' }).filter(
  (path) => path.endsWith('.css') && path !== 'global.css',
);

// Hand-kept selector lists missed new animations twice, in #18 and #97.
it('leaves reduced motion to the one rule in global.css', () => {
  expect(stylesheets).toContain(join('styles', 'player.module.css'));
  expect(
    stylesheets.filter((path) =>
      readFileSync(join(import.meta.dirname, path), 'utf8').includes('prefers-reduced-motion'),
    ),
    'global.css already stops every animation and transition; delete these reduced-motion rules',
  ).toEqual([]);
});
