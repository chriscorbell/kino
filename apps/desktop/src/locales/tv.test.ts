import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { tvStrings } from './tv';

const tvMain = '../android-tv/app/src/main';
const handWritten = readFileSync(join(tvMain, 'res/values/strings.xml'), 'utf8');
const resourceText = (xml: string) =>
  new Map([...xml.matchAll(/<string name="([^"]+)">(.*?)<\/string>/gs)].map((m) => [m[1], m[2]]));

it('names only string resources the TV uses and does not also write by hand', () => {
  const used = new Set(
    readdirSync(tvMain, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(kt|xml)$/.test(file))
      .flatMap((file) => [
        ...readFileSync(join(tvMain, file), 'utf8').matchAll(/(?:R\.string\.|@string\/)(\w+)/g),
      ])
      .map((match) => match[1]),
  );
  const written = resourceText(handWritten);
  for (const name of Object.keys(tvStrings)) {
    expect(used.has(name), `${name} is unused on the TV`).toBe(true);
    expect(written.has(name), `${name} is also in strings.xml`).toBe(false);
  }
});

// Decodes generated resource text the way Android does, with the format arguments filled in. The
// resource compiler rejects a bare apostrophe and drops a bare double quote, and String.format
// rejects a lone percent sign.
function onTv(raw: string, args: (string | number)[]) {
  const text = raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\(.)|(['"])/g, (_, escape?: string, bare?: string) => {
      if (bare) throw new Error(`unescaped ${bare} in ${raw}`);
      return escape === 'n' ? '\n' : (escape ?? '');
    });
  if (!args.length) return text;
  return text.replace(/%((\d+)\$[sd]|%)?/g, (_, conversion?: string, index?: string) => {
    if (!conversion) throw new Error(`lone % in ${raw}`);
    return index ? String(args[Number(index) - 1]) : '%';
  });
}

it('generates resources that read on the TV exactly as en-US.ts reads on desktop', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kino-tv-strings-'));
  try {
    const destination = join(directory, 'strings_shared.xml');
    execFileSync(process.execPath, ['../../scripts/generate-tv-strings.mjs', destination]);
    const generated = resourceText(readFileSync(destination, 'utf8'));
    expect([...generated.keys()]).toEqual(Object.keys(tvStrings));
    for (const [name, entry] of Object.entries(tvStrings)) {
      const [message, ...formats] = typeof entry === 'object' ? entry : [entry];
      const args = formats.map((format, i) => (format === 'd' ? 40 + i : `arg${i}`));
      const desktop =
        typeof message === 'function'
          ? (message as (...values: (string | number)[]) => string)(...args)
          : message;
      expect(typeof desktop === 'string' && desktop.trim() !== '', name).toBe(true);
      expect(onTv(generated.get(name) ?? '', args), name).toBe(desktop);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
