import ts from 'typescript';
import { enUS } from '../locales/en-US.ts';

// The desktop client's own source, without tests, test support, or the locales themselves.
export const sources = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '!../**/*.test.*', '!../test/**', '!../locales/**', '!../**/*.d.ts'],
  { eager: true, import: 'default', query: '?raw' },
);

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string' || typeof value === 'function') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

export function valueAt(value: unknown, keys: string[]) {
  return keys.reduce<unknown>(
    (parent, key) =>
      parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[key] : undefined,
    value,
  );
}

/** Every en-US message path the desktop client reads, from `t.` and `enUS.` accesses in its source. */
export function desktopMessagePaths() {
  const paths = new Set<string>();
  for (const [path, source] of Object.entries(sources)) {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      // Only a whole chain names a message: enUS.settings inside enUS.settings.on reads one leaf.
      if (ts.isPropertyAccessExpression(node) && !ts.isPropertyAccessExpression(node.parent)) {
        const keys: string[] = [];
        let root: ts.Expression = node;
        while (ts.isPropertyAccessExpression(root)) {
          keys.unshift(root.name.text);
          root = root.expression;
        }
        if (ts.isIdentifier(root) && (root.text === 't' || root.text === 'enUS')) {
          const value = valueAt(enUS, keys);
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
  return paths;
}
