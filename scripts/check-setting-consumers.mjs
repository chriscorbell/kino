#!/usr/bin/env node
// Fails when a platform the settings schema lists for a Kino setting has nothing there that reads
// it. Settings showed and stored a Match frame rate switch that nothing else read until #98
// removed it. The check reads source:
//
//   desktop  each setting a desktop platform lists is read as settings.<key>, or the store's
//            get().<key>, outside the settings modules and SettingsScreen.tsx.
//   TV       each setting the TV lists is read as [KinoSettings.<key>] outside TvSettings.kt, and
//            is written by one put(KinoSettings.<key>, ...), which every place that changes it
//            calls. No main source names a preference by its raw key, which would get around the
//            typed entry and both counts. The scan sees a key written as a string literal in the
//            call, not one held in a variable.
//
// A read in source does not prove the value is applied. The shell_capabilities CTest holds what
// each shell reports to the schema.
//
//   node scripts/check-setting-consumers.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { desktopPlatforms, settingsSchema } from '../packages/settings/src/schema.ts';

const root = join(import.meta.dirname, '..');

function sources(dir, pattern) {
  return readdirSync(join(root, dir), { recursive: true })
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => pattern.test(file))
    .map((file) => ({ path: `${dir}/${file}`, text: readFileSync(join(root, dir, file), 'utf8') }));
}

const settingsScreen = 'apps/desktop/src/screens/SettingsScreen.tsx';
const notConsumers = new Set([
  'apps/desktop/src/settings.ts',
  'apps/desktop/src/settingsStore.ts',
  'apps/desktop/src/useKinoSettings.ts',
  settingsScreen,
]);
const desktop = sources('apps/desktop/src', /^(?!test\/).*(?<!\.test)\.tsx?$/).filter(
  ({ path }) => !notConsumers.has(path),
);

const tvSettings = 'apps/android-tv/app/src/main/java/app/kino/tv/TvSettings.kt';
const nameOfKey = new Map(
  Object.entries(settingsSchema).flatMap(([name, { platforms }]) =>
    platforms.tv ? [[platforms.tv.key, name]] : [],
  ),
);
const tvPatterns = {
  read: /\[\s*KinoSettings\.(\w+)\s*\]/g,
  write: /\bput\(\s*KinoSettings\.(\w+)/g,
  raw: /\b(?:(?:get|put)(?:Boolean|String|StringSet|Int|Long|Float)|remove)\(\s*"([^"]+)"/g,
};
/** Each place TV main source reads, writes or names by raw key a setting the schema lists. */
const tvUses = sources('apps/android-tv/app/src/main/java', /\.kt$/)
  .filter(({ path }) => !path.endsWith('/KinoSettings.kt'))
  .flatMap(({ path, text }) =>
    Object.entries(tvPatterns).flatMap(([kind, pattern]) =>
      [...text.matchAll(pattern)].map((match) => ({
        kind,
        name: kind === 'raw' ? nameOfKey.get(match[1]) : match[1],
        path,
        line: text.slice(0, match.index).split('\n').length,
      })),
    ),
  );

const at = ({ path, line }) => `${path}:${line}`;
const problems = [];
for (const [name, { platforms }] of Object.entries(settingsSchema)) {
  // The lookbehind passes over enUS.settings.<key>, the text Settings shows for the setting.
  const read = new RegExp(String.raw`(?<![\w.$])settings\.${name}\b|\.get\(\)\.${name}\b`);
  if (
    desktopPlatforms.some((platform) => platforms[platform]) &&
    !desktop.some(({ text }) => read.test(text))
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
  if (writers.length > 1)
    problems.push(
      `${name} is written in ${writers.length} places: ${writers.map(at).join(', ')}. Keep one writer, and call it from the other places.`,
    );
  for (const use of uses('raw'))
    problems.push(
      `${at(use)} names the "${platforms.tv.key}" preference by its raw key. Read it as settings[KinoSettings.${name}] and write it with put(KinoSettings.${name}, value).`,
    );
}

for (const problem of problems) console.error(problem);
if (problems.length) process.exit(1);
console.log(
  'Every setting the schema lists has a reader on desktop and the TV, one writer on the TV, and no TV source names it by its raw key.',
);
