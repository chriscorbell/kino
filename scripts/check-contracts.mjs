#!/usr/bin/env node
// Fails when a contract document names a gate that does not exist: a package script, a scripts/,
// fixtures/ or workflow path, a vitest file, a TV test class or a CTest, in backticks or on a
// line of a fenced block. It also fails on a malformed planned marker, and with --release, while a
// public release ships a platform that a planned marker says lacks the promise. The contracts
// promised Copy Diagnostic Summary (#55) and opening external sources (#75) before either was
// built, and nothing said so until an audit found them.
//
//   node scripts/check-contracts.mjs [repository root]
//   node scripts/check-contracts.mjs --release macos,windows,linux,tv [--dry-run] [repository root]
//
// A promise not built yet carries <!-- planned: <platforms>. <reason> --> inside its heading,
// paragraph, list item or table row. With --dry-run, --release lists those promises as GitHub
// notices instead of failing; the Release workflow passes it for a pre-release or a run by hand.
//
// A name introduced as an example ("such as", "for example", "e.g.") is not a gate. Left
// unchecked: other repository paths, pnpm with --filter or other options than -C, Gradle tasks,
// and a CTest named without "CTest" or "native test" after it or ctest -R before it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const {
  values: { release, 'dry-run': dryRun },
  positionals: [root = join(import.meta.dirname, '..')],
} = parseArgs({
  options: { release: { type: 'string' }, 'dry-run': { type: 'boolean' } },
  allowPositionals: true,
});
const read = (path) => readFileSync(join(root, path), 'utf8');

const DOCS = ['docs/PRODUCT.md', 'docs/PLAYBACK.md', 'docs/DESKTOP.md', 'docs/ANDROID-TV.md'];
const PLATFORMS = {
  macos: ['macos'],
  windows: ['windows'],
  linux: ['linux'],
  desktop: ['macos', 'windows', 'linux'],
  tv: ['tv'],
};
const PLATFORM_WORDS = Object.keys(PLATFORMS).join(', ');
const MARKER_FORM = `<!-- planned: <platforms>. <reason> --> with platforms from ${PLATFORM_WORDS}`;
// pnpm's own commands, from `pnpm help` in pnpm 11. A same-named package script still wins.
const PNPM_COMMANDS = new Set(
  `access init recursive add install i install-test update up outdated audit change version lane
  bugs list ls ll licenses why view sbom whoami deprecate undeprecate unpublish star unstar stars
  dist-tag ping doctor search rebuild rb pack publish stage remove rm patch patch-commit
  patch-remove peers set-script test t run exec dlx create completion start stop restart find-hash
  runtime env shim bin clean purge ci root prefix config get set pkg pack-app store cache cat-file
  cat-index ignored-builds approve-builds link import dedupe deploy prune fetch unlink docs repo
  self-update setup login team owner logout with help`.split(/\s+/),
);
const ANDROIDX_FILTERS = new Set(['SmallTest', 'MediumTest', 'LargeTest', 'FlakyTest']);
const EXAMPLE = /(?:such as|for example|e\.g\.,?) $/i;

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const scriptsIn = (dir) =>
  existsSync(join(root, dir, 'package.json'))
    ? (JSON.parse(read(join(dir, 'package.json'))).scripts ?? {})
    : {};
const ctests = tracked
  .filter((file) => basename(file) === 'CMakeLists.txt')
  .flatMap((file) => {
    const text = read(file);
    const loops = [...text.matchAll(/foreach\(\s*(\w+)\s+([^)]*)\)[\s\S]*?endforeach/g)];
    return [...text.matchAll(/add_test\(\s*NAME\s+([^\s)]+)/g)].flatMap(({ 1: name, index }) => {
      const loop = loops.find((l) => index > l.index && index < l.index + l[0].length);
      return loop
        ? loop[2]
            .split(/\s+/)
            .filter(Boolean)
            .map((item) => name.replaceAll(`\${${loop[1]}}`, item))
        : [name];
    });
  });
const tvTestClasses = new Set(
  tracked
    .filter((file) => /^apps\/android-tv\/app\/src\/(?:androidTest|test)\/.*\.kt$/.test(file))
    .flatMap((file) => [...read(file).matchAll(/^(?:\w+ )*class (\w+)/gm)].map((m) => m[1])),
);

const KINDS = [
  {
    kind: 'package script',
    find: (span) => {
      const [, cd = '.', command = ''] =
        span.match(/^(?:cd (\S+) && )?(?:[A-Z_][A-Z0-9_]*=\S* )*pnpm (.*)/) ?? [];
      const words = command.split(/\s+/);
      let dir = cd;
      while (/^(?:-C|--dir)$/.test(words[0])) dir = join(dir, words.splice(0, 2)[1] ?? '');
      const [word, next] = words;
      const script =
        word === 'run'
          ? next
          : PNPM_COMMANDS.has(word) && !Object.hasOwn(scriptsIn(dir), word)
            ? undefined
            : word;
      return script && !script.startsWith('-')
        ? [dir === '.' ? script : `${script} in ${dir}`]
        : [];
    },
    resolves: (name) => {
      const [script, dir = '.'] = name.split(' in ');
      return Object.hasOwn(scriptsIn(dir), script);
    },
    missing: (name) => {
      const [script, dir] = name.split(' in ');
      return `\`pnpm ${script}\` names no package script${dir ? ` in ${dir}` : ''}`;
    },
  },
  {
    kind: 'repository path',
    find: (span) =>
      span
        .split(/\s+/)
        .map((t) => t.replace(/^\.\//, ''))
        .filter((t) => /^(?:scripts|fixtures|\.github\/workflows)\//.test(t) && !/[*<]/.test(t)),
    resolves: (path) =>
      tracked.some((file) => file === path || file.startsWith(path.replace(/\/?$/, '/'))),
    missing: (path) => `\`${path}\` names no tracked file or directory`,
  },
  {
    kind: 'vitest file',
    find: (span) => (/^[\w.-]+\.test\.tsx?$/.test(span) ? [span] : []),
    resolves: (name) =>
      tracked.some((file) => file.startsWith('apps/desktop/') && basename(file) === name),
    missing: (name) => `\`${name}\` names no tracked test file under apps/desktop`,
  },
  {
    kind: 'TV test class',
    find: (span) =>
      span
        .split(/\s+/)
        .map((t) => t.match(/^(?:[a-z]\w*\.)*([A-Z]\w*Test)$/)?.[1])
        .filter((name) => name && !ANDROIDX_FILTERS.has(name)),
    resolves: (name) => tvTestClasses.has(name),
    missing: (name) => `\`${name}\` names no class in the TV app's test sources`,
  },
  {
    kind: 'CTest',
    find: (span, after) => {
      const selected = span.match(/^ctest\b.*\s-R\s+(\w+)/)?.[1];
      if (selected) return [selected];
      return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(span) &&
        /^(?:,? (?:and |or )?`[^`]+`)* (?:CTests?|native tests?)\b/.test(after)
        ? [span]
        : [];
    },
    resolves: (name) => ctests.includes(name),
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
        return line.trim() && blocks.push({ doc, line: i + 1, text: `\`${line.trim()}\`` });
      if (/^\s*$/.test(line)) return flush();
      if (/^#/.test(line)) return (flush(), blocks.push({ doc, line: i + 1, text: line }));
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

// The claim a marker belongs to is the heading, sentence, or table row just before it.
function claimBefore(text) {
  const plain = text
    .replace(/<!--[\s\S]*?-->|\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(ITEM, '')
    .replace(/^#+ /, '')
    .split(/(?<=[.;?!]) /)
    .at(-1);
  return plain.length > 90 ? `${plain.slice(0, 87)}...` : plain;
}

const problems = [];
const resolved = new Set();
const planned = [];

for (const block of DOCS.flatMap(blocksOf)) {
  for (const m of block.text.matchAll(/`([^`\n]+)`/g)) {
    const before = block.text.slice(0, m.index);
    if (EXAMPLE.test(before)) continue;
    const after = block.text.slice(m.index + m[0].length);
    for (const { kind, find, resolves, missing } of KINDS)
      for (const name of find(m[1], after))
        if (resolves(name)) resolved.add(`${kind} ${name}`);
        else problems.push(`${block.doc}:${block.line}: ${missing(name)}`);
  }
  const outsideCode = block.text.replace(/`[^`\n]+`/g, (span) => ' '.repeat(span.length));
  for (const { 0: comment, 1: inner, index } of outsideCode.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (!/plan/i.test(inner)) continue;
    const line = block.line + block.text.slice(0, index).split('\n').length - 1;
    const where = `${block.doc}:${line}`;
    const [, words, reason] =
      inner.match(/^ planned: ([a-z]+(?:, [a-z]+)*)\. (\S[\s\S]*?) $/) ?? [];
    const platforms = words
      ?.split(', ')
      .map((word) => (Object.hasOwn(PLATFORMS, word) ? PLATFORMS[word] : undefined));
    const claim = claimBefore(block.text.slice(0, index));
    if (!platforms || platforms.includes(undefined))
      problems.push(`${where}: malformed planned marker ${comment}: write ${MARKER_FORM}`);
    else if (!claim)
      problems.push(
        `${where}: planned marker ${comment} follows no claim: put it after the claim, in the same heading, paragraph, list item or table row`,
      );
    else
      planned.push({ doc: block.doc, line, claim, platforms: new Set(platforms.flat()), reason });
  }
}

const released = new Set();
for (const word of release?.split(',') ?? [])
  if (Object.hasOwn(PLATFORMS, word)) PLATFORMS[word].forEach((platform) => released.add(platform));
  else problems.push(`--release: "${word}" is not a platform; use ${PLATFORM_WORDS}`);
for (const { doc, line, claim, platforms, reason } of planned) {
  const shipped = [...platforms.intersection(released)].join(', ');
  if (!shipped) continue;
  const promise = `${shipped} still promises "${claim}" (${reason})`;
  if (dryRun) console.log(`::notice file=${doc},line=${line}::${promise}`);
  else problems.push(`${doc}:${line}: a public release of ${promise}`);
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
