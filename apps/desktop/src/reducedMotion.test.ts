import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const text = (path: string) => readFileSync(resolve(root, path), 'utf8');

// Workspace packages such as the design tokens and the settings schema ship in the bundle too.
const { dependencies } = JSON.parse(text('apps/desktop/package.json')) as {
  dependencies: Record<string, string>;
};
const shipped = [
  'apps/desktop/src',
  ...Object.entries(dependencies)
    .filter(([, version]) => version.startsWith('workspace:'))
    .map(([name]) => `packages/${name.replace('@kino/', '')}/src`),
];

// Comments are blanked rather than removed, so a match reports the line it is on in the source.
const blank = (comment: string) => comment.replace(/[^\n]/g, ' ');
function code(path: string, source: string) {
  if (path.endsWith('.css')) return source.replace(/\/\*[\s\S]*?\*\//g, blank);
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const comments = new Map<number, number>();
  const visit = (node: ts.Node) => {
    for (const { pos, end } of [
      ...(ts.getLeadingCommentRanges(source, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(source, node.end) ?? []),
    ])
      comments.set(pos, end);
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return [...comments].reduce(
    (blanked, [pos, end]) =>
      blanked.slice(0, pos) + blank(blanked.slice(pos, end)) + blanked.slice(end),
    source,
  );
}

const files = Object.fromEntries(
  shipped.flatMap((dir) =>
    readdirSync(resolve(root, dir), { recursive: true, encoding: 'utf8' })
      .filter(
        (path) => /\.(css|tsx?)$/.test(path) && !/\.test\.|\.d\.ts$|^(test|locales)\//.test(path),
      )
      .map((path) => join(dir, path))
      .map((path) => [path, code(path, text(path))]),
  ),
);
const { 'apps/desktop/src/global.css': rule = '', ...rest } = files;
const moduleStylesheets = Object.fromEntries(
  Object.entries(rest).filter(([path]) => path.endsWith('.css')),
);

function matches(sources: Record<string, string>, pattern: RegExp) {
  return Object.entries(sources).flatMap(([path, source]) =>
    [...source.matchAll(pattern)].map(
      (match) => `${path}:${source.slice(0, match.index).split('\n').length}: ${match[0]}`,
    ),
  );
}

it('reads what the client ships', () => {
  expect(rule).toContain('prefers-reduced-motion');
  expect(Object.keys(files)).toEqual(
    expect.arrayContaining([
      'apps/desktop/src/App.tsx',
      'packages/design-tokens/src/tokens.css',
      'packages/settings/src/schema.ts',
    ]),
  );
});

it('probes the pseudo-elements the reduced-motion rules cover', () => {
  const pseudoElements = (source: string) => [...new Set(source.match(/::[\w-]+/g))].sort();
  expect(pseudoElements(text('scripts/test-support/reduced-motion.mjs'))).toEqual(
    pseudoElements(rule.slice(rule.indexOf('@media (prefers-reduced-motion'))),
  );
});

// Hand-kept selector lists missed new animations: #18 and #97 fixed misses, and the profile
// button's transition was still unlisted when the rule in global.css replaced them.
it('leaves reduced motion to the rules in global.css', () => {
  expect(
    matches(moduleStylesheets, /prefers-reduced-motion/g),
    'global.css already stops every animation and transition; delete these reduced-motion rules',
  ).toEqual([]);
  expect(
    matches(moduleStylesheets, /\b(?:animation|transition)[\w-]*\s*:[^;{}]*!\s*important/gi),
    'global.css stops motion with !important, which these outrank on screens the probes may never visit',
  ).toEqual([]);
});

// The rules reach only CSS animations and transitions, and the ones they stop fire no events.
it('keeps motion where the reduced-motion rules reach it', () => {
  expect(
    matches(
      files,
      /\.animate\(|\bnew Animation\b|KeyframeEffect|startViewTransition|behavior\s*:\s*['"]?smooth|(?:animation|transition)(?:start|end|iteration|run|cancel)/gi,
    ),
    'animate in CSS, which global.css stops under reduced motion, and wait for no animation or transition event',
  ).toEqual([]);
});
