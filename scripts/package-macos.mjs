#!/usr/bin/env node
// Packages Kino.app: bundles Qt and the remaining Homebrew libraries into the
// app so it runs on a clean Mac, then produces a DMG with SHA-256 checksums.
//
// The bundle is ad-hoc signed because rewriting load commands invalidates the
// existing signatures and Apple Silicon refuses to run the result otherwise.
// Distribution signing and notarization are deferred (ADR 0017).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLicenseNotices, verifyLicenseBundle } from './license-notices.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceApp = join(repoRoot, 'build', 'macos', 'Kino.app');
const distDir = join(repoRoot, 'build', 'dist');
const stagedApp = join(distDir, 'Kino.app');
const frameworksDir = join(stagedApp, 'Contents', 'Frameworks');

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

function runInstallNameTool(args, options = {}) {
  const retryDelay = new Int32Array(new SharedArrayBuffer(4));

  // macOS can briefly lock a freshly copied, signed Qt framework while checking it.
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      return run('install_name_tool', args, options);
    } catch (error) {
      const message = `${error.message ?? ''}\n${error.stderr ?? ''}`;
      if (!message.includes('Operation not permitted') || attempt === 10) throw error;

      if (attempt === 1) {
        console.warn(`Waiting for macOS to release ${basename(args.at(-1))}…`);
      }
      Atomics.wait(retryDelay, 0, 0, 1_000);
    }
  }
}

const qtPrefix = run('brew', ['--prefix', 'qt']).trim();

function version() {
  const plist = join(sourceApp, 'Contents', 'Info.plist');
  return run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]).trim();
}

const homebrewPrefix = run('brew', ['--prefix']).trim();
const searchPaths = [join(homebrewPrefix, 'lib'), join(qtPrefix, 'lib')];

function isExternal(path) {
  return (
    path.startsWith(`${homebrewPrefix}/`) ||
    path.startsWith('/usr/local/') ||
    path.startsWith('/opt/homebrew/')
  );
}

// Machine-specific dependencies must travel with the app. macdeployqt leaves
// behind unresolved @rpath references for transitive Homebrew libraries, so
// those are resolved against the Homebrew and Qt library directories.
function dependencies(binary) {
  return run('otool', ['-L', binary])
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter(Boolean)
    .filter((path) => path !== binary);
}

function resolveDependency(path) {
  if (isExternal(path) && !path.includes('.framework/')) return path;
  if (!path.startsWith('@rpath/')) return null;
  const name = path.slice('@rpath/'.length);
  if (name.includes('.framework/') || existsSync(join(frameworksDir, name))) return null;
  for (const directory of searchPaths) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function machOFiles() {
  const found = run('find', [stagedApp, '-type', 'f']).split('\n').filter(Boolean);
  return found.filter((path) => {
    if (/\.(dylib|so)$/.test(path)) return true;
    if (/\.(plist|qml|png|svg|json|js|html|css|wasm|nib|icns|txt|woff2?)$/i.test(path))
      return false;
    try {
      return run('file', ['-b', path]).includes('Mach-O');
    } catch {
      return false;
    }
  });
}

// Qt frameworks are copied by macdeployqt but some references keep their
// absolute Homebrew paths. Rewrite those to the bundled copies.
function frameworkSuffix(path) {
  const match = /([^/]+\.framework\/.*)$/.exec(path);
  return match ? match[1] : null;
}

function relativeRunpath(binary) {
  const depth = binary.slice(join(stagedApp, 'Contents').length + 1).split('/').length - 1;
  return `@loader_path/${'../'.repeat(depth)}Frameworks`;
}

// A bundled framework's own install name is its first otool entry; left at a
// Homebrew path it makes dependents load the system copy instead.
function installName(binary) {
  return run('otool', ['-D', binary]).split('\n')[1]?.trim() ?? '';
}

function rewriteFrameworks() {
  let rewritten = 0;
  for (const binary of machOFiles()) {
    let touched = false;
    const ownName = installName(binary);
    if (isExternal(ownName)) {
      const ownSuffix = frameworkSuffix(ownName);
      if (ownSuffix) {
        runInstallNameTool(['-id', `@rpath/${ownSuffix}`, binary]);
        rewritten += 1;
      }
    }
    for (const reference of dependencies(binary)) {
      if (!isExternal(reference)) continue;
      const suffix = frameworkSuffix(reference);
      if (!suffix) continue;
      const bundledPath = join(frameworksDir, suffix);
      if (!existsSync(bundledPath)) {
        const frameworkName = suffix.split('/')[0];
        const sourceFramework = reference.slice(
          0,
          reference.indexOf(frameworkName) + frameworkName.length,
        );
        run('ditto', [sourceFramework, join(frameworksDir, frameworkName)]);
      }
      runInstallNameTool(['-change', reference, `@rpath/${suffix}`, binary]);
      touched = true;
      rewritten += 1;
    }
    if (touched) addRunpath(binary, relativeRunpath(binary));
  }
  return rewritten;
}

function linkWebEngineFrameworks() {
  const helperContents = join(
    frameworksDir,
    'QtWebEngineCore.framework',
    'Versions',
    'A',
    'Helpers',
    'QtWebEngineProcess.app',
    'Contents',
  );
  const helperFrameworks = join(helperContents, 'Frameworks');
  if (!existsSync(helperContents) || existsSync(helperFrameworks)) return;

  // Homebrew's Qt libraries use @executable_path. The nested WebEngine helper
  // needs that path to resolve back to the outer app's bundled frameworks.
  symlinkSync(relative(helperContents, frameworksDir), helperFrameworks);
}

function bundleMissingQtFrameworks() {
  // QML plugins can introduce frameworks outside the shell's original rpaths.
  // macdeployqt reports those misses but still exits successfully.
  let copied;
  do {
    copied = false;
    for (const binary of machOFiles()) {
      for (const reference of dependencies(binary)) {
        if (!reference.startsWith('@rpath/Qt') || !reference.includes('.framework/')) continue;
        const suffix = reference.slice('@rpath/'.length);
        if (existsSync(join(frameworksDir, suffix))) continue;
        const name = suffix.split('/')[0];
        const source = searchPaths.map((path) => join(path, name)).find(existsSync);
        if (!source) throw new Error(`Cannot bundle required Qt framework ${name}`);
        run('ditto', [source, join(frameworksDir, name)]);
        copied = true;
      }
    }
  } while (copied);
}

function bundleDependencies() {
  mkdirSync(frameworksDir, { recursive: true });
  const bundled = new Set();
  const queue = machOFiles();

  while (queue.length > 0) {
    const binary = queue.shift();
    for (const reference of dependencies(binary)) {
      const source = resolveDependency(reference);
      if (!source) continue;
      const name = basename(source);
      const target = join(frameworksDir, name);
      if (!bundled.has(name)) {
        bundled.add(name);
        if (!existsSync(target)) {
          run('cp', ['-L', source, target]);
          run('chmod', ['u+w', target]);
        }
        runInstallNameTool(['-id', `@rpath/${name}`, target]);
        queue.push(target);
      }
      if (reference !== `@rpath/${name}`) {
        runInstallNameTool(['-change', reference, `@rpath/${name}`, binary]);
      }
    }
  }
  return bundled;
}

function addRunpath(binary, runpath) {
  try {
    runInstallNameTool(['-add_rpath', runpath, binary], { stdio: 'pipe' });
  } catch (error) {
    const message = `${error.message ?? ''}\n${error.stderr ?? ''}`;
    if (!message.includes('would duplicate path')) throw error;
  }
}

function sign(target) {
  run('codesign', ['--force', '--sign', '-', target]);
}

// Rewriting load commands invalidates existing signatures, so everything is
// re-signed from the inside out before the outer bundle.
function signEverything() {
  const byDepth = (left, right) => right.split('/').length - left.split('/').length;

  const nested = run('find', [
    stagedApp,
    '-type',
    'd',
    '-name',
    '*.framework',
    '-o',
    '-type',
    'd',
    '-name',
    '*.app',
  ])
    .split('\n')
    .filter((path) => path && path !== stagedApp)
    .sort(byDepth);

  const loose = machOFiles()
    .filter((path) => !nested.some((bundle) => path.startsWith(`${bundle}/`)))
    .sort(byDepth);

  for (const target of loose) sign(target);
  for (const bundle of nested) sign(bundle);
  sign(stagedApp);
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (!existsSync(sourceApp)) {
  console.error('Build the app first: pnpm macos:build');
  process.exit(1);
}

console.log('Staging the app bundle…');
rmSync(distDir, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });
run('ditto', [sourceApp, stagedApp]);

console.log('Bundling Qt…');
// -qmldir lets macdeployqt discover the QML modules the shell imports; the
// QML itself is compiled into the binary, so it cannot scan the bundle.
run(
  join(qtPrefix, 'bin', 'macdeployqt'),
  [
    stagedApp,
    '-always-overwrite',
    `-libpath=${join(qtPrefix, 'lib')}`,
    `-qmldir=${join(repoRoot, 'apps', 'macos-shell', 'qml')}`,
  ],
  { stdio: 'inherit' },
);
linkWebEngineFrameworks();

console.log('Bundling remaining libraries…');
const mainBinary = join(stagedApp, 'Contents', 'MacOS', 'Kino');
const engineBinary = join(stagedApp, 'Contents', 'MacOS', 'kino-stream-engine');
const executables = [mainBinary, ...(existsSync(engineBinary) ? [engineBinary] : [])];
bundleMissingQtFrameworks();
const bundled = bundleDependencies();
for (const executable of executables) addRunpath(executable, '@executable_path/../Frameworks');
for (const library of machOFiles()) {
  addRunpath(library, '@loader_path');
  addRunpath(library, relativeRunpath(library));
}
const rewritten = rewriteFrameworks();
console.log(`Bundled ${bundled.size} libraries and rewrote ${rewritten} framework references.`);

const remaining = machOFiles()
  .flatMap((binary) => dependencies(binary).map((path) => ({ binary, path })))
  .filter(
    ({ path }) =>
      isExternal(path) ||
      (path.startsWith('@rpath/Qt') &&
        path.includes('.framework/') &&
        !existsSync(join(frameworksDir, path.slice('@rpath/'.length)))),
  );
if (remaining.length > 0) {
  for (const { binary, path } of remaining.slice(0, 10)) {
    console.error(`  ${basename(binary)} still links ${path}`);
  }
  console.error('Machine-specific libraries remain linked.');
  process.exit(1);
}

console.log('Collecting dependency licenses and retained notices…');
generateLicenseNotices(stagedApp, machOFiles());

console.log('Signing ad-hoc…');
signEverything();
run('codesign', ['--verify', '--deep', '--strict', stagedApp]);

verifyLicenseBundle(stagedApp, machOFiles());
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
