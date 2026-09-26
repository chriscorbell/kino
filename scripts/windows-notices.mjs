// License notices for the Windows portable build. Like the other collectors, this reads only
// local inputs: the reviewed record in third_party/notices/windows.json, the installed npm
// closure, and the engine's Cargo graph for x86_64-pc-windows-msvc. The Windows workflow
// generates the notices on Linux, puts them beside Kino.exe as licenses/, and reads them back
// out of the finished folder.
//
//   node scripts/windows-notices.mjs check
//   node scripts/windows-notices.mjs generate [--cargo <cargo>]
//   node scripts/windows-notices.mjs verify <the portable folder>
//   node scripts/windows-notices.mjs check-toolchain <gcc version> <mingw-w64 version>
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
  isPortableExecutable,
  record,
  verifyPackage,
  verifyRecordTexts,
  writeNotices,
} from './record-notices.mjs';

const root = join(import.meta.dirname, '..');
const output = join(root, 'build/windows-notices');
const kinoBinaries = ['Kino.exe', 'kino-stream-engine.exe'];

const component = (name) => {
  const found = components('windows.json').find((c) => c.name === name);
  if (!found) throw new Error(`third_party/notices/windows.json has no ${name} entry`);
  return found;
};

// The sources scripts/build-windows-mpv.sh builds into libmpv-2.dll, by checksum, and the
// libplacebo commit it clones.
function libmpvSources() {
  const script = readFileSync(join(root, 'scripts/build-windows-mpv.sh'), 'utf8');
  const archives = [...script.matchAll(/^ {2}"([^|"]+)\|([^|"]+)\|([a-f0-9]{64})"$/gm)].map(
    ([, name, urls, sha256]) => ({ name, urls: urls.split(' '), sha256 }),
  );
  const libplacebo = script.match(/^kino_libplacebo_commit=([a-f0-9]{40})$/m)?.[1];
  if (!archives.length || !libplacebo)
    throw new Error('scripts/build-windows-mpv.sh no longer lists its sources as expected');
  return { archives, libplacebo };
}

export function verifyWindowsReview() {
  verifyRecordTexts('windows.json');
  const problems = [];
  const qt = readFileSync(join(root, '.github/workflows/windows.yml'), 'utf8').match(
    /^ {6}KINO_QT_VERSION: (\S+)$/m,
  )?.[1];
  if (qt !== record('windows.json').pins.qt)
    problems.push(
      `Windows builds Qt ${qt}, but its notices review Qt ${record('windows.json').pins.qt}.`,
    );

  const { archives, libplacebo } = libmpvSources();
  const linked = components('windows.json').filter((c) => c.binaries?.includes('libmpv-2.dll'));
  for (const archive of archives)
    if (!linked.some((c) => c.sourceArchiveSha256 === archive.sha256))
      problems.push(
        `libmpv-2.dll now builds ${archive.name} from ${archive.urls[0]}; review its notices and record that source.`,
      );
  if (component('libplacebo').revision !== libplacebo)
    problems.push(`libmpv-2.dll now builds libplacebo ${libplacebo}; review its notices.`);
  for (const item of linked)
    if (
      !item.toolchain &&
      item.sourceArchiveSha256 &&
      !archives.some((archive) => archive.sha256 === item.sourceArchiveSha256)
    )
      problems.push(`${item.name} ${item.version} is no longer built into libmpv-2.dll.`);
  if (problems.length) throw new Error(problems.join('\n'));
}

// The MinGW-w64 runtime and GCC's runtime libraries come from the cross-compiler, not from a
// pinned download, so the libmpv build checks the toolchain it used against their reviews.
export function verifyToolchain(gcc, mingw) {
  const reviewed = (name) =>
    components('windows.json').find((c) => c.toolchain === name)?.version ?? 'none';
  const problems = [];
  if (gcc.match(/^\d+/)?.[0] !== reviewed('gcc'))
    problems.push(
      `libmpv-2.dll was built with GCC ${gcc}, but its runtime is reviewed for ${reviewed('gcc')}.`,
    );
  if (mingw !== reviewed('mingw-w64'))
    problems.push(
      `libmpv-2.dll was built with MinGW-w64 ${mingw}, but its runtime is reviewed for ${reviewed('mingw-w64')}.`,
    );
  if (problems.length) throw new Error(problems.join('\n'));
}

export function generateWindowsNotices(cargo = 'cargo') {
  verifyReviewedNotices();
  verifyWindowsReview();
  rmSync(output, { recursive: true, force: true });
  const licenses = join(output, 'licenses');
  const collector = noticeCollector(licenses);
  collector.add({
    name: 'Kino',
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    scope: 'Application',
    license: 'GPL-3.0-only',
    repository: 'https://github.com/chriscorbell/kino',
    binaries: kinoBinaries,
    notes:
      'The complete source of this app, including the script that builds libmpv-2.dll and the workflow that builds everything else it carries, is available from the repository.',
    files: [...kinoSources, 'scripts/build-windows-mpv.sh'].map((p) =>
      collector.file(join(root, p), `Kino source: ${p}`),
    ),
  });
  collectWebInterface(collector);
  collectEngineCrates(
    collector,
    `${record('windows.json').pins.architecture}-pc-windows-msvc`,
    cargo,
  );
  addRecord(collector, 'windows.json');
  writeNotices(
    collector,
    licenses,
    "Installed npm runtime closure; the engine dependency graph Cargo selects for Windows; Qt's Windows binaries, the Microsoft C++ runtime, libmpv-2.dll, and what the engine links.",
  );
  console.log(`Collected Windows notices for ${collector.components.length} components.`);
}

export function verifyWindowsPackage(directory) {
  const { manifest, native } = verifyPackage({
    directory,
    prefix: '',
    licenses: join(directory, 'licenses'),
    isNative: isPortableExecutable,
  });
  engineRuntime(join(directory, 'kino-stream-engine.exe'), [component('rust-standard-library')]);
  console.log(
    `Verified Windows notices for ${manifest.components.length} components and ${native.length} native files.`,
  );
}

if (process.argv[1] === import.meta.filename) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'check') {
    verifyWindowsReview();
    console.log('Reviewed Windows notices match the Qt release and the libmpv build.');
  } else if (command === 'generate' && (!rest.length || (rest[0] === '--cargo' && rest[1])))
    generateWindowsNotices(rest[1]);
  else if (command === 'verify' && rest[0]) verifyWindowsPackage(rest[0]);
  else if (command === 'check-toolchain' && rest.length === 2) {
    verifyToolchain(rest[0], rest[1]);
    console.log('The cross-compiler matches the reviewed MinGW-w64 and GCC runtimes.');
  } else
    throw new Error(
      'Usage: node scripts/windows-notices.mjs check | generate [--cargo <cargo>] | verify <folder> | check-toolchain <gcc version> <mingw-w64 version>',
    );
}
