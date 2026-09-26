#!/usr/bin/env node
// Packages Kino.app: bundles the Qt and Homebrew libraries Kino loads into the
// app so it runs on a clean Mac, then produces a DMG with SHA-256 checksums.
//
// The bundle is ad-hoc signed because rewriting load commands invalidates the
// existing signatures and Apple Silicon refuses to run the result otherwise.
// Distribution signing and notarization are deferred (ADR 0017).
//
// Qt's macdeployqt is not used. Given `import QtQuick` it copies every module
// under QtQuick, 3D, PDF and the virtual keyboard included, and every plugin of
// each kind Qt ships, then spent nine of a release's twelve minutes rewriting
// them one process at a time. Packaging instead copies the QML modules
// qmlimportscanner names, the plugins below, and whatever those load, reading
// load commands itself and running the tools that edit binaries in parallel.

import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { availableParallelism } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { generateLicenseNotices, verifyLicenseBundle } from './license-notices.mjs';
import { bundleProblems, machOFiles, readMachO, walk } from './macho.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
// Packaging builds its own Release configuration beside the Debug development
// build, so probes keep their assertions and a shipped bundle never carries them.
const releaseBuildDir = join(repoRoot, 'build', 'macos-release');
const sourceApp = join(releaseBuildDir, 'Kino.app');
const distDir = join(repoRoot, 'build', 'dist');
const stagedApp = join(distDir, 'Kino.app');
const contents = join(stagedApp, 'Contents');
const frameworksDir = join(contents, 'Frameworks');
const pluginsDir = join(contents, 'PlugIns');
const qmlDir = join(contents, 'Resources', 'qml');

// The plugins a session loads, read back with DYLD_PRINT_LIBRARIES: the Cocoa
// platform, and every TLS backend, since Qt chooses one at run time. Image
// formats, input methods, positioning, multimedia and SQL drivers go unused.
const plugins = [
  'platforms/libqcocoa.dylib',
  'tls/libqcertonlybackend.dylib',
  'tls/libqopensslbackend.dylib',
  'tls/libqsecuretransportbackend.dylib',
];

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

const execFileAsync = promisify(execFile);

async function inParallel(items, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(availableParallelism(), items.length) }, worker));
}

async function editBinary(args) {
  // macOS can briefly lock a freshly copied, signed Qt framework while checking it.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await execFileAsync('install_name_tool', args);
    } catch (error) {
      if (!`${error.stderr ?? ''}`.includes('Operation not permitted') || attempt === 10)
        throw error;
      await new Promise((done) => setTimeout(done, 1_000));
    }
  }
}

const qtPrefix = run('brew', ['--prefix', 'qt']).trim();
const qtLib = join(qtPrefix, 'lib');
const homebrewLib = join(run('brew', ['--prefix']).trim(), 'lib');

// The disk image carries Kino's full version, pre-release label included; the bundle's own
// version fields hold only its numeric part.
function version() {
  return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
}

function isSystem(path) {
  return path.startsWith('/usr/lib/') || path.startsWith('/System/');
}

// A module's own files, without the modules nested inside it, which the scanner
// names separately when Kino needs them. A plugin lives in PlugIns, where a
// bundle keeps its code, and the module points at it.
function copyQmlModule(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    // Homebrew links each file into place from its keg.
    const from = realpathSync(join(source, entry));
    if (statSync(from).isDirectory()) {
      if (entry === 'designer' || existsSync(join(from, 'qmldir'))) continue;
      cpSync(from, join(target, entry), { recursive: true, dereference: true });
    } else if (entry.endsWith('.dylib')) {
      const plugin = join(pluginsDir, 'quick', entry);
      mkdirSync(dirname(plugin), { recursive: true });
      copyFileSync(from, plugin);
      symlinkSync(relative(target, plugin), join(target, entry));
    } else {
      copyFileSync(from, join(target, entry));
    }
  }
}

// The QML is compiled into the binary, so the scanner reads the sources.
function deployQml() {
  const scanned = JSON.parse(
    run(join(qtPrefix, 'share', 'qt', 'libexec', 'qmlimportscanner'), [
      '-rootPath',
      join(repoRoot, 'apps', 'macos-shell', 'qml'),
      '-importPath',
      join(qtPrefix, 'share', 'qt', 'qml'),
    ]),
  );
  const modules = scanned.filter((module) => module.type === 'module' && module.path);
  for (const module of modules) copyQmlModule(module.path, join(qmlDir, module.relativePath));
  return modules.length;
}

function deployPlugins() {
  for (const plugin of plugins) {
    const target = join(pluginsDir, plugin);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(realpathSync(join(qtPrefix, 'share', 'qt', 'plugins', plugin)), target);
  }
  writeFileSync(
    join(contents, 'Resources', 'qt.conf'),
    '[Paths]\nPlugins = PlugIns\nImports = Resources/qml\nQmlImports = Resources/qml\n',
  );
}

// Copies everything the bundle's binaries load, and what that loads in turn,
// and returns the load command edits that point each binary at the copies.
function bundleDependencies() {
  const origins = new Map();
  const copied = new Map();
  const edits = new Map();
  const queue = machOFiles(stagedApp);
  const edit = (binary) => {
    if (!edits.has(binary)) edits.set(binary, { id: null, changes: new Map() });
    return edits.get(binary);
  };

  const place = (reference, binary) => {
    if (isSystem(reference)) return null;
    const from = dirname(origins.get(binary) ?? binary);
    let source;
    if (reference.startsWith('@rpath/')) {
      const name = reference.slice('@rpath/'.length);
      source = [qtLib, homebrewLib, from].map((d) => join(d, name)).find((p) => existsSync(p));
    } else if (reference.startsWith('@loader_path/')) {
      source = resolve(from, reference.slice('@loader_path/'.length));
    } else if (reference.startsWith('/')) {
      source = reference;
    }
    if (!source || !existsSync(source))
      throw new Error(`Cannot find ${reference}, loaded by ${relative(stagedApp, binary)}`);
    const framework = /\/([^/]+\.framework)\/(.+)$/.exec(source);
    if (framework) {
      const [, name, inner] = framework;
      return { name, suffix: `${name}/${inner}`, source: source.slice(0, -inner.length - 1) };
    }
    return { name: basename(reference), suffix: basename(reference), source };
  };

  const copy = ({ name, suffix, source }) => {
    const known = copied.get(name);
    if (known) {
      if (known !== realpathSync(source))
        throw new Error(`Two libraries are both named ${name}: ${known} and ${source}`);
      return;
    }
    const real = realpathSync(source);
    copied.set(name, real);
    const target = join(frameworksDir, name);
    if (name.endsWith('.framework')) {
      cpSync(real, target, { recursive: true, verbatimSymlinks: true });
      // Headers and qmake's link records serve building against Qt, not running it.
      for (const leftover of ['Headers', ...readdirSync(target).filter((p) => p.endsWith('.prl'))])
        rmSync(join(target, leftover), { force: true, recursive: true });
      rmSync(join(target, 'Versions', 'A', 'Headers'), { force: true, recursive: true });
      for (const binary of machOFiles(target)) {
        origins.set(binary, join(real, relative(target, binary)));
        queue.push(binary);
      }
      edit(join(target, suffix.slice(name.length + 1))).id = `@rpath/${suffix}`;
    } else {
      copyFileSync(real, target);
      origins.set(target, real);
      queue.push(target);
      edit(target).id = `@rpath/${name}`;
    }
  };

  mkdirSync(frameworksDir, { recursive: true });
  while (queue.length > 0) {
    const binary = queue.shift();
    chmodSync(binary, 0o755);
    for (const reference of readMachO(binary).dylibs) {
      const placed = place(reference, binary);
      if (!placed) continue;
      copy(placed);
      if (reference !== `@rpath/${placed.suffix}`)
        edit(binary).changes.set(reference, `@rpath/${placed.suffix}`);
    }
  }
  return { copied, edits };
}

// Every binary finds the bundled libraries through one search path of its own,
// relative to where it sits, and nowhere else: Homebrew's paths would let a
// Mac with Homebrew hide a library the bundle is missing.
async function rewriteBinaries(edits) {
  const binaries = machOFiles(stagedApp);
  await inParallel(binaries, async (binary) => {
    const { id, changes } = edits.get(binary) ?? { id: null, changes: new Map() };
    const depth = relative(contents, dirname(binary)).split('/').length;
    const args = [
      ...(id ? ['-id', id] : []),
      ...[...changes].flatMap(([from, to]) => ['-change', from, to]),
      ...[...new Set(readMachO(binary).rpaths)].flatMap((path) => ['-delete_rpath', path]),
      '-add_rpath',
      `@loader_path/${'../'.repeat(depth)}Frameworks`,
      binary,
    ];
    await execFileAsync('strip', ['-x', binary]);
    await editBinary(args);
  });
  return binaries.length;
}

// Rewriting load commands invalidates existing signatures, so everything is
// re-signed from the inside out before the outer bundle. Bundles at one depth
// hold nothing of each other's and sign in parallel.
async function signEverything() {
  const sign = (paths) => execFileAsync('codesign', ['--force', '--sign', '-', ...paths]);
  const batches = (paths) =>
    Array.from({ length: Math.ceil(paths.length / 16) }, (_, i) =>
      paths.slice(i * 16, i * 16 + 16),
    );
  const nested = walk(contents)
    .directories.filter((path) => /\.(framework|app)$/.test(path))
    .sort((left, right) => right.split('/').length - left.split('/').length);
  const loose = machOFiles(stagedApp).filter(
    (path) => !nested.some((bundle) => path.startsWith(`${bundle}/`)),
  );

  await inParallel(batches(loose), sign);
  const depths = [...new Set(nested.map((path) => path.split('/').length))];
  for (const depth of depths)
    await inParallel(batches(nested.filter((path) => path.split('/').length === depth)), sign);
  await sign([stagedApp]);
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

execFileSync(join(repoRoot, 'scripts', 'build-macos.sh'), [], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KINO_MACOS_BUILD_DIR: releaseBuildDir,
    KINO_MACOS_BUILD_TYPE: 'Release',
    KINO_MACOS_BUILD_TESTING: 'OFF',
  },
});
const buildType = readFileSync(join(releaseBuildDir, 'CMakeCache.txt'), 'utf8').match(
  /^CMAKE_BUILD_TYPE:STRING=(.*)$/m,
)?.[1];
if (buildType !== 'Release') {
  throw new Error(
    `Refusing to package a ${buildType ?? 'unknown'} build; packages are Release only`,
  );
}

console.log('Staging the app bundle…');
rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });
run('ditto', [sourceApp, stagedApp]);

console.log('Bundling Qt and its libraries…');
const modules = deployQml();
deployPlugins();
const { copied, edits } = bundleDependencies();
const rewritten = await rewriteBinaries(edits);
console.log(
  `Bundled ${copied.size} frameworks and libraries, ${plugins.length} plugins and ` +
    `${modules} QML modules, and pointed ${rewritten} binaries at them.`,
);

const problems = bundleProblems(stagedApp);
if (problems.length > 0) {
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  console.error('The bundle does not load only what it carries.');
  process.exit(1);
}

console.log('Collecting dependency licenses and retained notices…');
generateLicenseNotices(stagedApp, machOFiles(stagedApp));

console.log('Signing ad-hoc…');
await signEverything();
run('codesign', ['--verify', '--deep', '--strict', stagedApp]);

verifyLicenseBundle(stagedApp, machOFiles(stagedApp));
if (process.argv.includes('--no-dmg')) {
  console.log(`Packaged ${stagedApp}`);
  process.exit(0);
}

console.log('Building the disk image…');
const appVersion = version();
const dmgPath = join(distDir, `Kino-${appVersion}-arm64.dmg`);
run('hdiutil', [
  'create',
  '-quiet',
  '-fs',
  'HFS+',
  '-format',
  'UDZO',
  '-volname',
  `Kino ${appVersion}`,
  '-srcfolder',
  stagedApp,
  '-ov',
  dmgPath,
]);

const checksumPath = join(distDir, 'SHA256SUMS');
writeFileSync(checksumPath, `${checksum(dmgPath)}  ${basename(dmgPath)}\n`);

console.log(`\nPackaged ${dmgPath}`);
console.log(readFileSync(checksumPath, 'utf8').trim());
