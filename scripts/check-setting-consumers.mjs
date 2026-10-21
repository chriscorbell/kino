#!/usr/bin/env node
// Fails when a platform the settings schema lists for a Kino setting has nothing there that reads
// it. Settings showed and stored a Match frame rate switch that nothing else read until #98
// removed it. The check reads source:
//
//   desktop  each setting a desktop platform lists is read as settings.<key>, or the store's
//            get().<key>, outside the settings modules, SettingsScreen.tsx and tests.
//   TV       each setting the TV lists is read as [KinoSettings.<key>] outside TvSettings.kt, and
//            has exactly one writer, which every place that changes it calls. A writer is
//            put(KinoSettings.<key>, ...) with the setting positional or named,
//            KinoSettings.<key>.write(...), or a put or remove of KinoSettings.<key>.key. No main
//            source names a preference by its raw key in a get, put, remove or contains call or an
//            all[...] lookup, which would get around the typed entry and both counts.
//
// It matches source text after blanking comments and the text of string literals, so a mention
// in either counts for nothing; the raw-key scan blanks only comments. It does not see a read
// through destructuring, a setting or raw key held in a variable or alias, or TV source outside
// .kt files. A read in source does not prove the value is applied. The shell_capabilities CTest
// holds what each shell reports to the schema.
//
// Before the real tree, it runs the planted cases in test-support/setting-consumer-cases.mjs and
// fails when it gets one wrong.
//
//   node scripts/check-setting-consumers.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { desktopPlatforms, settingsSchema } from '../packages/settings/src/schema.ts';
import { baseline, cases } from './test-support/setting-consumer-cases.mjs';

const desktopDir = 'apps/desktop/src';
const tvDir = 'apps/android-tv/app/src/main/java';
const settingsScreen = `${desktopDir}/screens/SettingsScreen.tsx`;
const notConsumers = new Set([
  `${desktopDir}/settings.ts`,
  `${desktopDir}/settingsStore.ts`,
  `${desktopDir}/useKinoSettings.ts`,
  settingsScreen,
]);
const desktopSource = /^(?!test\/).*(?<!\.test|\.spec)\.tsx?$/;
const tvSettings = `${tvDir}/app/kino/tv/TvSettings.kt`;
const generated = `${tvDir}/app/kino/tv/KinoSettings.kt`;

const blank = (text) => text.replace(/[^\n]/g, ' ');

const literalKinds = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);

/** TypeScript source with comments and literal text blanked; template expressions stay. */
function typeScriptCode(path, text) {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const ranges = [];
  // A node's leading trivia, from its full start to its first token, holds its comments.
  const visit = (node) => {
    ranges.push([node.pos, literalKinds.has(node.kind) ? node.end : node.getStart(source)]);
    node.getChildren(source).forEach(visit);
  };
  visit(source);
  let code = '';
  let done = 0;
  for (const [from, to] of ranges.sort(([a], [b]) => a - b)) {
    if (to <= done) continue;
    const start = Math.max(done, from);
    code += text.slice(done, start) + blank(text.slice(start, to));
    done = to;
  }
  return code + text.slice(done);
}

/**
 * Kotlin source with comments blanked, and with the text of string and character literals blanked
 * too unless keepStrings. ${...} templates inside strings stay code.
 */
function kotlinCode(text, keepStrings) {
  let code = '';
  let i = 0;
  const keep = (to) => {
    code += text.slice(i, to);
    i = to;
  };
  const drop = (to) => {
    code += blank(text.slice(i, to));
    i = to;
  };
  const literal = (to) => (keepStrings ? keep(to) : drop(to));

  function block() {
    let depth = 0;
    while (i < text.length) {
      if (text.startsWith('//', i)) {
        const end = text.indexOf('\n', i);
        drop(end < 0 ? text.length : end);
      } else if (text.startsWith('/*', i)) comment();
      else if (text.startsWith('"""', i)) string('"""');
      else if (text[i] === '"' || text[i] === "'") string(text[i]);
      else if (text[i] === '{') {
        depth += 1;
        keep(i + 1);
      } else if (text[i] === '}') {
        if (depth === 0) return;
        depth -= 1;
        keep(i + 1);
      } else keep(i + 1);
    }
  }
  function comment() {
    let depth = 0;
    do {
      if (text.startsWith('/*', i)) {
        depth += 1;
        drop(i + 2);
      } else if (text.startsWith('*/', i)) {
        depth -= 1;
        drop(i + 2);
      } else drop(i + 1);
    } while (depth > 0 && i < text.length);
  }
  function string(quote) {
    keep(i + quote.length);
    // A raw string closes at the last three of a run of quotes, so """a"""" holds a".
    const closes = () =>
      text.startsWith(quote, i) && !(quote === '"""' && text.startsWith('""""', i));
    while (i < text.length && !closes()) {
      if (text.startsWith('${', i)) {
        keep(i + 2);
        block();
        keep(i + 1);
      } else literal(quote !== '"""' && text[i] === '\\' ? i + 2 : i + 1);
    }
    keep(i + quote.length);
  }

  while (i < text.length) {
    block();
    keep(i + 1);
  }
  return code;
}

const tvPatterns = {
  read: /\[\s*KinoSettings\.(\w+)\s*\]/g,
  write: new RegExp(
    [
      String.raw`\bput\(\s*(?:[^()]*?\bsetting\s*=\s*)?KinoSettings\.(\w+)\b(?!\s*\.key\b)`,
      String.raw`\bKinoSettings\.(\w+)\s*\.write\(`,
      String.raw`\b(?:put\w*|remove)\(\s*KinoSettings\.(\w+)\s*\.key\b`,
    ].join('|'),
    'g',
  ),
};
const rawKey =
  /\b(?:(?:get|put)(?:Boolean|String|StringSet|Int|Long|Float)|remove|contains)\(\s*"([^"]+)"|\b(?:all|getAll\(\))\s*\[\s*"([^"]+)"\s*\]/g;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const at = ({ path, line }) => `${path}:${line}`;

/** Each problem in a tree of source files, a map from repository path to text, for a schema. */
function consumerProblems(files, schema) {
  const desktop = [...files]
    .filter(([path]) => path.startsWith(`${desktopDir}/`) && !notConsumers.has(path))
    .filter(([path]) => desktopSource.test(path.slice(desktopDir.length + 1)))
    .map(([path, text]) => typeScriptCode(path, text));

  const nameOfKey = new Map(
    Object.entries(schema).flatMap(([name, { platforms }]) =>
      platforms.tv ? [[platforms.tv.key, name]] : [],
    ),
  );
  const tvUses = [...files]
    .filter(([path]) => path.startsWith(`${tvDir}/`) && path.endsWith('.kt') && path !== generated)
    .flatMap(([path, text]) => {
      const code = kotlinCode(text, false);
      const withStrings = kotlinCode(text, true);
      return [
        ...Object.entries(tvPatterns).flatMap(([kind, pattern]) =>
          [...code.matchAll(pattern)].map((match) => ({
            kind,
            name: match.slice(1).find(Boolean),
            path,
            line: lineOf(code, match.index),
          })),
        ),
        ...[...withStrings.matchAll(rawKey)].map((match) => ({
          kind: 'raw',
          name: nameOfKey.get(match.slice(1).find(Boolean)),
          path,
          line: lineOf(withStrings, match.index),
        })),
      ];
    });

  const problems = [];
  for (const [name, { platforms }] of Object.entries(schema)) {
    // The lookbehind passes over enUS.settings.<key>, the text Settings shows for the setting.
    const read = new RegExp(
      String.raw`(?<!\btypeof\s+)(?:(?<![\w.$])settings|\.get\(\))\.${name}\b`,
    );
    if (
      desktopPlatforms.some((platform) => platforms[platform]) &&
      !desktop.some((code) => read.test(code))
    )
      problems.push(
        `${name} is listed for desktop, but nothing outside the settings modules and ${settingsScreen} reads settings.${name}.`,
      );
    if (!platforms.tv) continue;

    const uses = (kind) => tvUses.filter((use) => use.name === name && use.kind === kind);
    if (!uses('read').some(({ path }) => path !== tvSettings))
      problems.push(
        `${name} is listed for the TV, but nothing outside ${tvSettings} reads [KinoSettings.${name}].`,
      );
    const writers = uses('write');
    if (!writers.length)
      problems.push(
        `${name} is listed for the TV, but nothing writes it with put(KinoSettings.${name}, value).`,
      );
    if (writers.length > 1)
      problems.push(
        `${name} is written in ${writers.length} places: ${writers.map(at).join(', ')}. Keep one writer, and call it from the other places.`,
      );
    for (const use of uses('raw'))
      problems.push(
        `${at(use)} names the "${platforms.tv.key}" preference by its raw key. Read it as settings[KinoSettings.${name}] and write it with put(KinoSettings.${name}, value).`,
      );
  }
  return problems;
}

const missed = cases.flatMap(({ label, plant, reports }) => {
  const files = new Map(baseline.files);
  plant(files);
  const problems = consumerProblems(files, baseline.schema);
  const caught = reports
    ? problems.length > 0 && problems.every((problem) => problem.includes(reports))
    : problems.length === 0;
  return caught
    ? []
    : [
        `The check got a planted case wrong. ${label}: ${problems.join(' ') || 'no problem reported'}`,
      ];
});
if (missed.length) {
  for (const miss of missed) console.error(miss);
  process.exit(1);
}

const root = join(import.meta.dirname, '..');
const files = new Map(
  [desktopDir, tvDir].flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true })
      .map((file) => `${dir}/${file.replaceAll('\\', '/')}`)
      .filter((path) => /\.(?:tsx?|kt)$/.test(path))
      .map((path) => [path, readFileSync(join(root, path), 'utf8')]),
  ),
);
const problems = consumerProblems(files, settingsSchema);
for (const problem of problems) console.error(problem);
if (problems.length) process.exit(1);
console.log(
  `Every setting the schema lists has a reader on desktop and the TV, one writer on the TV, and no TV source names it by its raw key. The check caught its ${cases.length} planted cases.`,
);
