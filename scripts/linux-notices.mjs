// License notices for the Linux Flatpak. Like the macOS collector, this reads only local inputs:
// the reviewed record in third_party/notices/linux.json, the installed npm closure, and the
// engine's Cargo graph for the Flatpak's target. The Flatpak workflow generates the notices
// before flatpak-builder runs, since the build sandbox has neither node_modules nor the crates,
// and reads them back out of the installed app afterwards.
//
//   node scripts/linux-notices.mjs check
//   node scripts/linux-notices.mjs generate [--cargo <cargo>]
//   node scripts/linux-notices.mjs verify <the installed app's files directory>
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  collectEngineCrates,
  collectWebInterface,
  engineRuntime,
  kinoSources,
  noticeCollector,
  verifyReviewedNotices,
} from './license-notices.mjs';
import {
  addRecord,
  components,
  isElf,
  verifyPackage,
  verifyRecordTexts,
  writeNotices,
} from './record-notices.mjs';

const root = join(import.meta.dirname, '..');
const flatpakManifest = join(root, 'packaging/flatpak/com.chriscorbell.Kino.yml');
const output = join(root, 'build/linux-notices');
const installed = 'share/kino/licenses';
const kinoBinaries = ['/app/bin/Kino', '/app/bin/kino-stream-engine'];
const reviewed = JSON.parse(readFileSync(join(root, 'third_party/notices/linux.json'), 'utf8'));

const component = (name) => {
  const found = components('linux.json').find((c) => c.name === name);
  if (!found) throw new Error(`third_party/notices/linux.json has no ${name} entry`);
  return found;
};

// The manifest's modules and the values their sources pin. Every module is a list item at two
// spaces of indentation, and its sources' keys sit deeper, so reading keys per block is enough.
function flatpakModules() {
  const text = readFileSync(flatpakManifest, 'utf8');
  const modules = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const start = line.match(/^ {2}- name: (\S+)$/);
    if (start) {
      current = { name: start[1], pins: new Set() };
      modules.set(current.name, current);
      continue;
    }
    const pin = line.match(/^\s+-?\s*(url|commit|sha256|tag): (\S+)$/);
    if (current && pin) current.pins.add(`${pin[1]}:${pin[2]}`);
  }
  return { text, modules };
}

export function verifyLinuxReview() {
  verifyRecordTexts('linux.json');
  const { text, modules } = flatpakModules();
  const problems = [];
  const baseBranch = reviewed.pins.baseApp.split('//')[1];
  if (!new RegExp(`^base-version: '${baseBranch.replace('.', '\\.')}'$`, 'm').test(text))
    problems.push(
      `The Flatpak no longer builds on ${reviewed.pins.baseApp}; review what the new base app puts in /app.`,
    );
  const covered = new Set(Object.keys(reviewed.buildOnly));
  for (const item of reviewed.components.filter((c) => c.flatpakModule)) {
    covered.add(item.flatpakModule);
    const module = modules.get(item.flatpakModule);
    if (!module) {
      problems.push(`${item.name}'s module ${item.flatpakModule} is no longer in the manifest.`);
      continue;
    }
    const expected = item.revision
      ? [`commit:${item.revision}`]
      : [`url:${item.sourceArchive}`, `sha256:${item.sourceArchiveSha256}`];
    if (!expected.every((pin) => module.pins.has(pin)))
      problems.push(
        `The Flatpak's ${item.flatpakModule} module moved from ${item.name} ${item.version}; review its notices at the new source.`,
      );
  }
  for (const name of modules.keys())
    if (!covered.has(name))
      problems.push(`The Flatpak module ${name} has no reviewed notices in linux.json.`);
  if (problems.length) throw new Error(problems.join('\n'));
}

export function generateLinuxNotices(cargo = 'cargo') {
  verifyReviewedNotices();
  verifyLinuxReview();
  rmSync(output, { recursive: true, force: true });
  const licenses = join(output, 'licenses');
  const collector = noticeCollector(licenses);
  const { file, add } = collector;
  add({
    name: 'Kino',
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    scope: 'Application',
    license: 'GPL-3.0-only',
    repository: 'https://github.com/chriscorbell/kino',
    binaries: kinoBinaries,
    notes:
      'The complete source of this app, including the Flatpak manifest that builds every native library it carries, is available from the repository.',
    files: [...kinoSources, 'packaging/flatpak/com.chriscorbell.Kino.yml'].map((p) =>
      file(join(root, p), `Kino source: ${p}`),
    ),
  });
  collectWebInterface(collector);
  collectEngineCrates(collector, `${reviewed.pins.architecture}-unknown-linux-gnu`, cargo);
  addRecord(collector, 'linux.json');
  writeNotices(
    collector,
    licenses,
    'Installed npm runtime closure; the engine dependency graph Cargo selects for Linux; the native code the Flatpak puts in /app. The KDE runtime carries its own notices.',
  );
  console.log(`Collected Linux notices for ${collector.components.length} components.`);
}

// The installed app, not the generated directory, is what people receive.
export function verifyLinuxApp(files) {
  const { manifest, everything, native } = verifyPackage({
    directory: files,
    prefix: '/app/',
    licenses: join(files, installed),
    isNative: isElf,
    skip: (packaged) => packaged.startsWith('/app/lib/debug/'),
  });
  engineRuntime(join(files, 'bin/kino-stream-engine'), [component('rust-standard-library')]);
  const webEngine = everything.find((f) =>
    /\/libQt6WebEngineCore\.so\.\d+\.\d+\.\d+$/.test(f.packaged),
  );
  const webEngineVersion = webEngine?.packaged.match(/\.so\.(\d+\.\d+\.\d+)$/)[1];
  if (webEngineVersion !== component('qtwebengine').version)
    throw new Error(
      `The base app now carries Qt WebEngine ${webEngineVersion ?? 'in an unknown version'}; review its notices and the libraries it builds.`,
    );
  console.log(
    `Verified Linux notices for ${manifest.components.length} components and ${native.length} native files.`,
  );
}

if (process.argv[1] === import.meta.filename) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'check') {
    verifyLinuxReview();
    console.log('Reviewed Linux notices match the Flatpak manifest.');
  } else if (command === 'generate' && (!rest.length || (rest[0] === '--cargo' && rest[1])))
    generateLinuxNotices(rest[1]);
  else if (command === 'verify' && rest[0]) verifyLinuxApp(rest[0]);
  else
    throw new Error(
      'Usage: node scripts/linux-notices.mjs check | generate [--cargo <cargo>] | verify <files>',
    );
}
