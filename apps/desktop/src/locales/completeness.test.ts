import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { locales, resolveLocaleTag } from './index';

const sources = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.*', '!../test/**', '!../locales/**', '!../**/*.d.ts'],
  { eager: true, import: 'default', query: '?raw' },
);

it('generates the native fallback from the same messages and locale resolver', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kino-locale-'));
  try {
    const destination = join(directory, 'NativeLocale.js');
    execFileSync(process.execPath, ['../../scripts/generate-native-locale.mjs', destination]);
    const source = readFileSync(destination, 'utf8').replace('.pragma library', '');
    const resolve = runInNewContext(`${source}\nmessages`) as (tags: string[]) => unknown;
    for (const tags of [[], ['en-US'], ['en-GB'], ['de-DE', 'en-AU']]) {
      expect(resolve(tags)).toEqual(locales[resolveLocaleTag(tags)]?.native);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string' || typeof value === 'function') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function valueAt(value: unknown, keys: string[]) {
  return keys.reduce<unknown>(
    (parent, key) =>
      parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[key] : undefined,
    value,
  );
}

it('covers the actual UI message paths in every registered locale', () => {
  const paths = new Set<string>();
  for (const [path, source] of Object.entries(sources)) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) {
        const keys: string[] = [];
        let root: ts.Expression = node;
        while (ts.isPropertyAccessExpression(root)) {
          keys.unshift(root.name.text);
          root = root.expression;
        }
        if (ts.isIdentifier(root) && (root.text === 't' || root.text === 'enUS')) {
          const value = valueAt(locales['en-US'], keys);
          // A dynamic lookup such as transportIssues[issue] consumes its group.
          if (value && typeof value === 'object')
            leafPaths(value, keys.join('.')).forEach((key) => paths.add(key));
          else paths.add(keys.join('.'));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  expect(paths.size).toBeGreaterThan(200);
  for (const [tag, messages] of Object.entries(locales)) {
    for (const path of paths) {
      const value = valueAt(messages, path.split('.'));
      expect(
        typeof value === 'function' || (typeof value === 'string' && Boolean(value.trim())),
        `${tag}.${path}`,
      ).toBe(true);
    }
  }
});

it('keeps literal UI text and accessible labels out of JSX', () => {
  const failures: string[] = [];
  const copyAttributes = new Set([
    'alt',
    'aria-label',
    'aria-description',
    'aria-valuetext',
    'placeholder',
    'title',
    'label',
    'description',
  ]);
  for (const [path, source] of Object.entries(sources)) {
    if (!path.endsWith('.tsx')) continue;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node) =>
      failures.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
    const literalCopy = (node: ts.Node) => {
      if (
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        /[A-Za-z]/.test(node.text)
      )
        report(node);
      // Conditional predicates and callback bodies contain protocol identifiers.
      else if (ts.isConditionalExpression(node)) {
        literalCopy(node.whenTrue);
        literalCopy(node.whenFalse);
      } else if (
        ts.isBinaryExpression(node) &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
          node.operatorToken.kind,
        )
      )
        literalCopy(node.right);
      else if (ts.isTemplateExpression(node)) {
        literalCopy(node.head);
        node.templateSpans.forEach((span) => literalCopy(span.literal));
      }
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) report(node);
      if (
        ts.isJsxAttribute(node) &&
        copyAttributes.has(node.name.getText(file)) &&
        node.initializer
      ) {
        if (ts.isJsxExpression(node.initializer) && node.initializer.expression)
          literalCopy(node.initializer.expression);
        else literalCopy(node.initializer);
      }
      if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression)
        literalCopy(node.expression);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  expect(failures).toEqual([]);
});
