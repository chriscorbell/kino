// License notices for the Linux Flatpak. Like the macOS collector, this reads only local inputs:
// the reviewed record in third_party/notices/linux.json, the installed npm closure, and the
// engine's Cargo graph for the Flatpak's target. The Flatpak workflow generates the notices
// before flatpak-builder runs, since the build sandbox has neither node_modules nor the crates,
// and reads them back out of the installed app afterwards.
//
//   node scripts/linux-notices.mjs check
//   node scripts/linux-notices.mjs generate [--cargo <cargo>]
//   node scripts/linux-notices.mjs verify <the installed app's files directory>
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import {
  collectEngineCrates,
  collectWebInterface,
  engineRuntime,
  hash,
  kinoSources,
  noticeCollector,
  render,
  verifyReviewedNotices,
} from './license-notices.mjs';

const root = join(import.meta.dirname, '..');
const reviewedRoot = join(root, 'third_party/notices');
const flatpakManifest = join(root, 'packaging/flatpak/com.chriscorbell.Kino.yml');
const output = join(root, 'build/linux-notices');
const installed = 'share/kino/licenses';
const kinoBinaries = ['/app/bin/Kino', '/app/bin/kino-stream-engine'];
const reviewed = JSON.parse(readFileSync(join(reviewedRoot, 'linux.json'), 'utf8'));
const desktop = JSON.parse(readFileSync(join(reviewedRoot, 'reviewed.json'), 'utf8'));

const component = (name) => {
  const found = reviewed.components.find((c) => c.name === name);
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
  for (const item of reviewed.components) {
    if (!item.files.length) throw new Error(`No reviewed Linux texts for ${item.name}`);
    for (const file of item.files)
      if (hash(readFileSync(join(reviewedRoot, file.path))) !== file.sha256)
        throw new Error(`Reviewed notice changed: ${file.path}`);
  }
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
  const { components, file, supplement, add } = collector;
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
  for (const item of reviewed.components) add(supplement(item, item.scope));

  components.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
  const manifest = {
    schemaVersion: 1,
    scope:
      'Installed npm runtime closure; the engine dependency graph Cargo selects for Linux; the native code the Flatpak puts in /app. The KDE runtime carries its own notices.',
    components,
  };
  writeFileSync(join(licenses, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(licenses, 'index.html'), render(manifest, licenses));
  console.log(`Collected Linux notices for ${components.length} components.`);
}

// A glob over /app paths: ** crosses directories, * stays within one.
const pattern = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  );

// Regular files only: the base app's symlinks point at files the walk reaches anyway.
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function isElf(path) {
  const descriptor = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    return readSync(descriptor, magic, 0, 4, 0) === 4 && magic.toString('latin1') === '\x7fELF';
  } finally {
    closeSync(descriptor);
  }
}

// The installed app, not the generated directory, is what people receive, so the notices are
// read back from it and every native file in it must belong to a reviewed component.
export function verifyLinuxApp(files) {
  const licenses = join(files, installed);
  const manifest = JSON.parse(readFileSync(join(licenses, 'manifest.json'), 'utf8'));
  const index = readFileSync(join(licenses, 'index.html'), 'utf8');
  for (const item of manifest.components) {
    if (!item.files.length) throw new Error(`Empty notices: ${item.name}`);
    for (const f of item.files) {
      if (
        !/^texts\/[a-f0-9]{64}\.(txt|html)$/.test(f.path) ||
        !existsSync(join(licenses, f.path)) ||
        hash(readFileSync(join(licenses, f.path))) !== f.sha256
      )
        throw new Error(`Invalid packaged notice: ${item.name}/${f.path}`);
      if (!index.includes(`id="text-${f.sha256}"`))
        throw new Error(`The notices page does not carry ${item.name}/${f.name}`);
    }
  }

  const everything = walk(files)
    .filter((path) => !relative(files, path).startsWith('lib/debug/'))
    .map((path) => ({ path, app: `/app/${relative(files, path)}` }));
  const globs = manifest.components.flatMap((item) =>
    (item.binaries ?? []).map((glob) => ({ item, glob, match: pattern(glob) })),
  );
  const native = everything.filter((f) => isElf(f.path));
  const unclaimed = native.filter((f) => !globs.some((g) => g.match.test(f.app)));
  const stale = globs.filter((g) => !everything.some((f) => g.match.test(f.app)));
  if (unclaimed.length || stale.length)
    throw new Error(
      [
        ...unclaimed.map((f) => `No notice inventory for ${f.app}`),
        ...stale.map((g) => `${g.item.name} claims ${g.glob}, which the app no longer carries`),
      ].join('\n'),
    );

  const rust = component('rust-standard-library');
  engineRuntime(join(files, 'bin/kino-stream-engine'), [rust]);
  const webEngine = everything.find((f) => /\/libQt6WebEngineCore\.so\.\d+\.\d+\.\d+$/.test(f.app));
  const webEngineVersion = webEngine?.app.match(/\.so\.(\d+\.\d+\.\d+)$/)[1];
  if (webEngineVersion !== component('qtwebengine').version)
    throw new Error(
      `The base app now carries Qt WebEngine ${webEngineVersion ?? 'in an unknown version'}; review its notices and the libraries it builds.`,
    );
  const wasm = everything.filter(
    (f) => f.app.startsWith('/app/share/kino/ui/') && f.app.endsWith('.wasm'),
  );
  if (!wasm.some((f) => hash(readFileSync(f.path)) === desktop.coreProvenance.wasm.sha256))
    throw new Error('The packaged Core WASM does not match its reviewed notices.');
  for (const required of [
    'Kino',
    'react',
    '@stremio/stremio-core-web',
    'mpv',
    'FFmpeg',
    'qtwebengine',
  ])
    if (!manifest.components.some((c) => c.name === required))
      throw new Error(`Required notices missing: ${required}`);
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
