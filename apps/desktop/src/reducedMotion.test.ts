import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { sources } from './test/messagePaths';

const root = resolve(import.meta.dirname, '../../..');
const read = (dir: string, extension: string) =>
  readdirSync(resolve(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith(extension) && !path.includes('.test.'))
    .map((path) => [join(dir, path), readFileSync(resolve(root, dir, path), 'utf8')]);

// The design tokens and the settings schema ship in the client bundle too.
const stylesheets = Object.fromEntries([
  ...read('apps/desktop/src', '.css'),
  ...read('packages/design-tokens/src', '.css'),
]);
const scripts = Object.fromEntries([
  ...Object.entries(sources).map(([path, text]) => [
    relative(root, resolve(import.meta.dirname, 'test', path)),
    text,
  ]),
  ...read('packages/settings/src', '.ts'),
]);
const { 'apps/desktop/src/global.css': rule, ...moduleStylesheets } = stylesheets;

function comments(path: string, text: string): ts.TextRange[] {
  if (path.endsWith('.css'))
    return [...text.matchAll(/\/\*[\s\S]*?\*\//g)].map((match) => ({
      pos: match.index,
      end: match.index + match[0].length,
    }));
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const ranges: ts.TextRange[] = [];
  const visit = (node: ts.Node) => {
    ranges.push(
      ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ...(ts.getTrailingCommentRanges(text, node.end) ?? []),
    );
    node.getChildren(file).forEach(visit);
  };
  visit(file);
  return ranges;
}

// Comments are blanked rather than removed, so each match reports the line it is on in the source.
function matches(files: Record<string, string>, pattern: RegExp) {
  return Object.entries(files).flatMap(([path, text]) => {
    const code = comments(path, text).reduce(
      (blanked, { pos, end }) =>
        blanked.slice(0, pos) + blanked.slice(pos, end).replace(/[^\n]/g, ' ') + blanked.slice(end),
      text,
    );
    return [...code.matchAll(pattern)].map(
      (match) => `${path}:${code.slice(0, match.index).split('\n').length}: ${match[0]}`,
    );
  });
}

it('reads the stylesheets and scripts the client ships', () => {
  expect(rule).toContain('prefers-reduced-motion');
  expect(Object.keys(moduleStylesheets)).toContain('packages/design-tokens/src/tokens.css');
  expect(Object.keys(scripts)).toContain('packages/settings/src/schema.ts');
  expect(Object.keys(scripts)).toContain('apps/desktop/src/App.tsx');
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
      { ...scripts, ...stylesheets },
      /\.animate\(|\bnew Animation\b|KeyframeEffect|startViewTransition|behavior\s*:\s*['"]?smooth|(?:animation|transition)(?:start|end|iteration|run|cancel)/gi,
    ),
    'animate in CSS, which global.css stops under reduced motion, and wait for no animation or transition event',
  ).toEqual([]);
});
