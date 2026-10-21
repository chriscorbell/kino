#!/usr/bin/env node
// Fails when a contract document names a gate that does not exist: a package script, a scripts/,
// fixtures/ or workflow path, a vitest file, a TV device test or a CTest written in backticks. It
// also fails on a malformed planned marker, and with --release, while a public release ships a
// platform that a planned marker says lacks the promise. The contracts promised Copy Diagnostic
// Summary (#55) and opening external sources (#75) before either was built, and nothing said so
// until an audit found them.
//
//   node scripts/check-contracts.mjs [repository root]
//   node scripts/check-contracts.mjs --release macos,windows,linux,tv [repository root]
//
// A promise not built yet carries <!-- planned: <platforms>. <reason> --> inside its paragraph,
// list item or table row. A version with a pre-release label only lists those promises.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const releaseAt = args.indexOf('--release');
const release = releaseAt < 0 ? undefined : (args.splice(releaseAt, 2)[1] ?? '');
const root = args[0] ?? join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const DOCS = ['docs/PRODUCT.md', 'docs/PLAYBACK.md', 'docs/DESKTOP.md', 'docs/ANDROID-TV.md'];
const PLATFORMS = {
  macos: ['macos'],
  windows: ['windows'],
  linux: ['linux'],
  desktop: ['macos', 'windows', 'linux'],
  tv: ['tv'],
};
const MARKER_FORM = `<!-- planned: <platforms>. <reason> --> with platforms from ${Object.keys(PLATFORMS).join(', ')}`;
const PNPM_OWN = new Set(['install', 'add', 'exec', 'dlx', 'run']);

const pkg = JSON.parse(read('package.json'));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const basenames = new Set(tracked.map((file) => basename(file)));
const ctests = tracked
  .filter((file) => basename(file) === 'CMakeLists.txt')
  .flatMap((file) => [...read(file).matchAll(/add_test\(\s*NAME\s+([^\s)]+)/g)].map((m) => m[1]));

const KINDS = [
  {
    kind: 'package script',
    find: (span) => {
      const [, word, next] = span.match(/^pnpm (\S+)(?: (\S+))?/) ?? [];
      return [word === 'run' ? next : PNPM_OWN.has(word) ? undefined : word].filter(Boolean);
    },
    resolves: (name) => Object.hasOwn(pkg.scripts, name),
    missing: (name) => `\`pnpm ${name}\` names no package script`,
  },
  {
    kind: 'repository path',
    find: (span) =>
      span
        .split(/\s+/)
        .filter((t) => /^(?:scripts|fixtures|\.github\/workflows)\//.test(t) && !/[*<]/.test(t)),
    resolves: (path) =>
      tracked.some((file) => file === path || file.startsWith(path.replace(/\/?$/, '/'))),
    missing: (path) => `\`${path}\` names no tracked file or directory`,
  },
  {
    kind: 'vitest file',
    find: (span) => (/^[\w.-]+\.test\.tsx?$/.test(span) ? [span] : []),
    resolves: (name) => basenames.has(name),
    missing: (name) => `\`${name}\` names no tracked test file`,
  },
  {
    kind: 'device test',
    find: (span) => (/^[A-Z]\w*Test$/.test(span) ? [span] : []),
    resolves: (name) => basenames.has(`${name}.kt`),
    missing: (name) => `\`${name}\` names no tracked ${name}.kt`,
  },
  {
    kind: 'CTest',
    find: (span, after) =>
      /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(span) &&
      /^(?:,? (?:and |or )?`[^`]+`)* (?:CTest|native tests?)\b/.test(after)
        ? [span]
        : [],
    resolves: (name) =>
      ctests.some(
        (test) => test === name || (test.includes('${') && name.startsWith(test.split('${')[0])),
      ),
    missing: (name) => `\`${name}\` names no add_test in a tracked CMakeLists.txt`,
  },
];

const ROW = /^\s*\|/;
const ITEM = /^\s*(?:[-*+]|\d+[.)]) /;

function blocksOf(doc) {
  const blocks = [];
  let cur;
  let fenced = false;
  const flush = () => cur && (blocks.push(cur), (cur = undefined));
  read(doc)
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(?:```|~~~)/.test(line)) return (flush(), (fenced = !fenced));
      if (fenced)
        return /^pnpm /.test(line) && blocks.push({ doc, line: i + 1, text: `\`${line}\`` });
      if (/^#|^\s*$/.test(line)) return flush();
      const joins =
        cur &&
        (/^\s*<!--.*-->\s*$/.test(line) ||
          (![line, cur.text].some((t) => ROW.test(t)) && !ITEM.test(line)));
      if (joins) return void (cur.text += '\n' + line);
      flush();
      cur = { doc, line: i + 1, text: line };
    });
  flush();
  return blocks;
}

// The claim a marker belongs to is the sentence, or the table row, just before it.
function claimBefore(text) {
  const plain = text
    .replace(/<!--[\s\S]*?-->|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ITEM, '')
    .split(/(?<=[.;?!]) /)
    .at(-1);
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain;
}

const problems = [];
const resolved = new Set();
const planned = [];

for (const block of DOCS.flatMap(blocksOf)) {
  const where = `${block.doc}:${block.line}`;
  for (const m of block.text.matchAll(/`([^`\n]+)`/g)) {
    const after = block.text.slice(m.index + m[0].length);
    for (const { kind, find, resolves, missing } of KINDS)
      for (const name of find(m[1], after))
        if (resolves(name)) resolved.add(`${kind} ${name}`);
        else problems.push(`${where}: ${missing(name)}`);
  }
  const outsideCode = block.text.replace(/`[^`\n]+`/g, (span) => ' '.repeat(span.length));
  for (const { 0: comment, 1: inner, index } of outsideCode.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (!/plan/i.test(inner)) continue;
    const [, words, reason] =
      inner.match(/^ planned: ([a-z]+(?:, [a-z]+)*)\. (\S[\s\S]*?) $/) ?? [];
    const platforms = words?.split(', ').map((word) => PLATFORMS[word]);
    if (!platforms || platforms.includes(undefined))
      problems.push(`${where}: malformed planned marker ${comment}: write ${MARKER_FORM}`);
    else
      planned.push({
        where,
        claim: claimBefore(block.text.slice(0, index)),
        platforms: new Set(platforms.flat()),
        reason,
      });
  }
}

const released = new Set();
for (const word of release?.split(',') ?? [])
  if (PLATFORMS[word]) PLATFORMS[word].forEach((platform) => released.add(platform));
  else
    problems.push(
      `--release: "${word}" is not a platform; use ${Object.keys(PLATFORMS).join(', ')}`,
    );
const prerelease = pkg.version.includes('-');
for (const { where, claim, platforms, reason } of planned) {
  const shipped = [...platforms.intersection(released)].join(', ');
  if (!shipped) continue;
  if (prerelease)
    console.log(
      `${where}: notice: pre-release ${pkg.version} of ${shipped} still promises "${claim}" (${reason})`,
    );
  else
    problems.push(`${where}: a public release of ${shipped} still promises "${claim}" (${reason})`);
}

for (const problem of problems) console.error(problem);
if (problems.length) process.exit(1);
const counts = [...new Set(Object.values(PLATFORMS).flat())]
  .map((platform) => [platform, planned.filter((p) => p.platforms.has(platform)).length])
  .filter(([, count]) => count)
  .map(([platform, count]) => `${platform} ${count}`);
console.log(
  `${DOCS.length} contract documents: ${resolved.size} gate names resolve; ${planned.length} planned promise${planned.length === 1 ? '' : 's'}${counts.length ? ` (${counts.join(', ')})` : ''}`,
);
