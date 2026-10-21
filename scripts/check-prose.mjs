#!/usr/bin/env node
// Fails when a change adds an em dash, or a term a CONTEXT.md entry lists under _Avoid_, to a
// line of prose or code. Both rules lived only in AGENTS.md and CONTEXT.md, and both were broken
// in merged work: #173 added an em dash and #224 called the TV's Local cache "torrent downloads".
//
//   node scripts/check-prose.mjs               lines added since the merge base with origin/main
//   node scripts/check-prose.mjs BASE [HEAD]   lines added between two commits
//
// Only added lines count, so wording already on main does not fail every change.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedLines } from './added-lines.mjs';

const root = join(import.meta.dirname, '..');

const PATHS = [
  ...['md', 'ts', 'tsx', 'mjs', 'kt', 'xml', 'cpp', 'h', 'qml'].map((ext) => `*.${ext}`),
  ':(exclude)third_party',
  ':(exclude)build',
  ':(exclude,glob)**/fixtures/**',
];
// These files name the avoided terms on purpose.
const TERM_EXEMPT = new Set(['CONTEXT.md', 'scripts/check-prose.mjs']);

// Avoided terms that also have a correct meaning in Kino, so matching them would take judgment.
const UNMATCHED = {
  Plugin: 'Qt and Gradle plugins are real build concepts.',
  channel: 'audio channels.',
  'Add-on settings':
    "an add-on's own settings page is real; the term is wrong only for its result.",
  upgrade: 'dependency upgrades.',
  pairing: 'ordinary English for matching two things.',
  remote: 'the TV remote and git remotes.',
  File: 'files are everywhere in code and docs.',
  provider: 'the Add-on entry itself calls an add-on a provider.',
  Player: "Kino's player is a real component.",
  'Stremio Core':
    'Kino reads the pinned Stremio Core; the term is wrong only for the streaming engine.',
  Autoplay: "React's autoPlay attribute.",
  'Stereo track': 'a source can ship its own stereo track.',
  transcoding: 'Media3 API names, and docs that say Kino never transcodes.',
  'HDR passthrough': 'the contracts name it to decline it.',
  'Dolby Vision output': 'the contracts name it to decline it.',
  'Embedded player': 'the trailer error for embedded players that Kino cannot play.',
  'Intro chapter': 'a Matroska chapter labeled intro is a real marker source.',
  'Detected intro': 'every intro segment is detected, so "detected intro segment" is accurate.',
  'Skip Intro': 'the name of a real action.',
  'Profile setting': 'the Stremio profile carries its own settings, which Kino reads.',
  'account setting': 'the Stremio account carries its own settings, which Kino reads.',
  Analytics: 'the privacy promises name it to rule it out.',
  telemetry: 'the privacy promises name it to rule it out.',
  Download: 'the Update notice offers Download; "torrent download" below covers the cache misuse.',
  Build: 'builds are everywhere in code and docs.',
  snapshot: 'test and state snapshots.',
  'Validation gate': 'docs/RISKS.md uses it for the gates that decide whether a layer stays.',
  CI: 'CI is a real system.',
  'Auto-update': "upstream stream-server's own auto-update setting, which Kino disables.",
};
// Narrow phrases matched in place of an unmatched term, named with the entry they belong to.
const NARROWED = [{ term: 'torrent download', entry: 'Local cache' }];

function avoidedTerms() {
  const terms = [];
  let entry;
  for (const line of readFileSync(join(root, 'CONTEXT.md'), 'utf8').split('\n')) {
    entry = line.match(/^\*\*(.+)\*\*:$/)?.[1] ?? entry;
    const avoid = line.match(/^_Avoid_: (.*)$/)?.[1];
    if (!avoid) continue;
    for (const term of avoid
      .replace(/\([^)]*\)/g, '')
      .split(',')
      .map((t) => t.trim()))
      if (term) terms.push({ term, entry });
  }
  return terms;
}

const listed = avoidedTerms();
const listedTerms = new Set(listed.map((t) => t.term));
const stale = Object.keys(UNMATCHED).filter((term) => !listedTerms.has(term));
if (stale.length) {
  console.error(
    `CONTEXT.md no longer avoids ${stale.map((t) => `"${t}"`).join(', ')}. Remove them from UNMATCHED in scripts/check-prose.mjs.`,
  );
  process.exit(1);
}
const matchers = [...listed.filter(({ term }) => !(term in UNMATCHED)), ...NARROWED].map(
  ({ term, entry }) => ({
    entry,
    pattern: new RegExp(
      `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ -]/g, '[\\s-]')}s?\\b`,
      'i',
    ),
  }),
);

const { label, lines } = changedLines('prose', PATHS);
const problems = [];
const files = new Set();
for (const { file, number, text } of lines) {
  const at = `${file}:${number}`;
  files.add(file);
  if (text.includes('\u2014'))
    problems.push(`${at}: em dash. AGENTS.md "Conventions" asks for a period or comma instead.`);
  if (TERM_EXEMPT.has(file)) continue;
  for (const { entry, pattern } of matchers) {
    const hit = text.match(pattern)?.[0];
    if (hit)
      problems.push(`${at}: CONTEXT.md avoids "${hit}". Say "${entry}", or reword in its terms.`);
  }
}

for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(
    `Prose: ${problems.length} problem${problems.length === 1 ? '' : 's'} on added lines.`,
  );
  process.exit(1);
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(
  `Examined ${plural(lines.length, 'added line')} in ${plural(files.size, 'file')}, ${label}, against ${matchers.length} terms.`,
);
if (!lines.length) console.log('No added lines in the file types this check reads.');
