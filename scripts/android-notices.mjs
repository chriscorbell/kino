// License notices for the Android TV APK. Like the macOS collector, this reads
// only local inputs: the reviewed record in third_party/notices/android.json,
// the Cargo graph of the Core that scripts/build-android.py just compiled, and
// Kino's own license. It writes the index the TV app shows under Settings and
// then checks the finished APK carries it.
//
//   node scripts/android-notices.mjs check
//   node scripts/android-notices.mjs generate --cargo <pinned cargo>
//   node scripts/android-notices.mjs verify-apk <apk>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';

import { hash, noticeFiles } from './license-notices.mjs';

const root = join(import.meta.dirname, '..');
const reviewedRoot = join(root, 'third_party/notices');
const vendor = join(root, 'build/vendor/stremio-core-kotlin');
const output = join(root, 'build/android-notices');
const coreLibrary = 'lib/arm64-v8a/libstremio_core_kotlin.so';
const reviewed = JSON.parse(readFileSync(join(reviewedRoot, 'android.json'), 'utf8'));

// The build script is the source of truth for every pinned input, so the record is compared
// against it rather than repeating the values somewhere a later bump could miss.
function buildPins() {
  const script = readFileSync(join(root, 'scripts/build-android.py'), 'utf8');
  const constant = (name) => {
    const match = script.match(new RegExp(`^${name} = "([^"]+)"`, 'm'));
    if (!match) throw new Error(`scripts/build-android.py no longer defines ${name}`);
    return match[1];
  };
  const decoders = script.match(/^FFMPEG_DECODERS = \[([^\]]*)\]/m);
  return {
    revision: constant('REVISION'),
    toolchain: constant('TOOLCHAIN'),
    media3: constant('MEDIA3_REVISION'),
    ffmpeg: constant('FFMPEG_TAG'),
    decoders: [...(decoders?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  };
}

function releaseArtifacts() {
  return readFileSync(join(root, 'apps/android-tv/app/gradle.lockfile'), 'utf8')
    .split('\n')
    .filter((line) => /=(.*,)?releaseRuntimeClasspath(,|$)/.test(line))
    .map((line) => line.split('=')[0])
    .sort();
}

const component = (name) => {
  const found = reviewed.components.find((c) => c.name === name);
  if (!found) throw new Error(`third_party/notices/android.json has no ${name} entry`);
  return found;
};

export function verifyAndroidReview() {
  const groups = [...reviewed.maven, ...reviewed.crates, ...reviewed.components];
  for (const item of groups) {
    if (!item.files.length)
      throw new Error(`No reviewed Android texts for ${item.name ?? item.license}`);
    for (const file of item.files)
      if (hash(readFileSync(join(reviewedRoot, file.path))) !== file.sha256)
        throw new Error(`Reviewed notice changed: ${file.path}`);
  }

  const pins = buildPins();
  const problems = [];
  if (reviewed.pins.coreRevision !== pins.revision)
    problems.push(`Core moved to ${pins.revision}; review its crate graph and supplements.`);
  if (component('rust-standard-library').version !== pins.toolchain)
    problems.push(`Rust moved to ${pins.toolchain}; retain that release's COPYRIGHT-library.html.`);
  if (component('FFmpeg').version !== pins.ffmpeg)
    problems.push(`FFmpeg moved to ${pins.ffmpeg}; review its license and linked sources.`);
  if (component('Media3 FFmpeg decoder extension').version !== pins.media3)
    problems.push(`Media3 moved to ${pins.media3}; review the FFmpeg extension's license.`);
  if (reviewed.pins.ffmpegDecoders.join() !== pins.decoders.join())
    problems.push('The FFmpeg decoder set changed; review which FFmpeg sources are linked.');

  const lock = (path) => hash(readFileSync(join(root, path)));
  if (reviewed.pins.coreLockSha256 !== lock('apps/android-tv/core/Cargo.lock'))
    problems.push(
      'apps/android-tv/core/Cargo.lock changed. Build the TV app to collect the new graph, add supplements for crates it reports without notices, then update coreLockSha256.',
    );

  const artifacts = releaseArtifacts();
  const covered = reviewed.maven.flatMap((group) => group.artifacts);
  const unreviewed = artifacts.filter((a) => !covered.includes(a));
  const stale = covered.filter((a) => !artifacts.includes(a));
  if (unreviewed.length || stale.length || new Set(covered).size !== covered.length)
    problems.push(
      [
        'The release runtime classpath and the reviewed Maven artifacts differ.',
        ...unreviewed.map((a) => `  unreviewed: ${a}`),
        ...stale.map((a) => `  no longer shipped: ${a}`),
        'Read each new POM license, look inside the artifact for NOTICE or license files, and record it.',
      ].join('\n'),
    );
  else if (reviewed.pins.gradleLockfileSha256 !== lock('apps/android-tv/app/gradle.lockfile'))
    problems.push(
      'apps/android-tv/app/gradle.lockfile changed without changing the release artifacts. Confirm that, then update gradleLockfileSha256.',
    );
  if (problems.length) throw new Error(problems.join('\n'));
}

export function generateAndroidNotices(cargo) {
  verifyAndroidReview();
  const licenses = join(output, 'licenses');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(join(licenses, 'texts'), { recursive: true });
  const components = [];
  function file(path, source, name = basename(path), extra = {}) {
    const data = readFileSync(path);
    const sha256 = hash(data);
    const target = `texts/${sha256}${path.endsWith('.html') ? '.html' : '.txt'}`;
    writeFileSync(join(licenses, target), data);
    return { ...extra, name, path: target, source, sha256 };
  }
  const retained = (files) =>
    files.map(({ path, source, name, sha256, ...extra }) =>
      file(join(reviewedRoot, path), source, name, extra),
    );
  function add(item) {
    if (!item.files.length)
      throw new Error(`No notice text for ${item.scope}: ${item.name} ${item.version}`);
    item.files = [...new Map(item.files.map((f) => [f.sha256, f])).values()];
    components.push(item);
  }

  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  add({
    name: 'Kino',
    version,
    license: 'GPL-3.0-only',
    repository: 'https://github.com/chriscorbell/kino',
    scope: 'Application',
    notes:
      'The complete source of this app, including the scripts that build every native library it carries, is available from the repository.',
    files: [file(join(root, 'LICENSE'), 'Kino source: LICENSE', 'LICENSE')],
  });

  const pins = buildPins();
  const rust = component('rust-standard-library');
  for (const item of reviewed.components) {
    const { files, ...metadata } = item;
    add({
      ...metadata,
      scope: ['Geist', 'Lucide'].includes(item.name) ? 'Fonts and icons' : 'Playback and Core',
      ...(item === rust ? { binaries: [coreLibrary] } : {}),
      files: retained(files),
    });
  }

  // The graph compiled into the Core library, with build dependencies: openssl-src compiles
  // OpenSSL into it, and the macros and build scripts are counted as the macOS Core graph counts
  // them. Supplements cover the crates whose published sources carry no notice file.
  const manifest = join(vendor, 'Cargo.toml');
  const cargoArgs = ['--offline', '--locked', '--manifest-path', manifest];
  const target = 'aarch64-linux-android';
  const run = (args) =>
    execFileSync(cargo, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const tree = run([
    'tree',
    ...cargoArgs,
    '--target',
    target,
    '-p',
    'stremio-core-kotlin',
    '-e',
    'normal,build',
    '--prefix',
    'none',
    '--format',
    '{p}',
  ]);
  const selected = new Set([...tree.matchAll(/^(\S+) v(\S+)/gm)].map((m) => `${m[1]}@${m[2]}`));
  const metadata = JSON.parse(
    run(['metadata', ...cargoArgs, '--format-version', '1', '--filter-platform', target]),
  );
  const used = new Set();
  for (const pkg of metadata.packages) {
    const id = `${pkg.name}@${pkg.version}`;
    if (!selected.has(id)) continue;
    const directory = dirname(pkg.manifest_path);
    const source = (path) => {
      const inside = relative(directory, path);
      if (pkg.source?.startsWith('registry+'))
        return `https://static.crates.io/crates/${pkg.name}/${id.replace('@', '-')}.crate#${pkg.name}-${pkg.version}/${inside}`;
      if (pkg.source?.startsWith('git+')) {
        const [, url, rev] = pkg.source.match(/^git\+([^?#]+)(?:\?[^#]*)?#([a-f0-9]{40})$/);
        const checkout = path.match(/^(.*\/git\/checkouts\/[^/]+\/[^/]+)\//)[1];
        return `${url.replace(/\.git$/, '')}/blob/${rev}/${relative(checkout, path)}`;
      }
      return `https://github.com/Stremio/stremio-core-kotlin/blob/${pins.revision}/${relative(vendor, path)}`;
    };
    const files = noticeFiles(directory).map((path) => file(path, source(path)));
    const supplements = reviewed.crates.filter(
      (c) => c.name === pkg.name && c.version === pkg.version,
    );
    for (const item of supplements) {
      used.add(id);
      files.push(...retained(item.files));
    }
    add({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? supplements[0]?.license,
      repository: pkg.repository ?? supplements[0]?.repository,
      scope: 'Stremio Core',
      ...(pkg.name === 'stremio-core-kotlin'
        ? {
            binaries: [coreLibrary],
            notes:
              'Kino builds this library from the pinned revision with the patches in its source. The Kotlin bindings from the matching 1.15.0 release are compiled into the app alongside it.',
          }
        : {}),
      ...(supplements.some((s) => s.notes)
        ? {
            notes: supplements
              .map((s) => s.notes)
              .filter(Boolean)
              .join(' '),
          }
        : {}),
      files,
    });
  }
  const unused = reviewed.crates.filter((c) => !used.has(`${c.name}@${c.version}`));
  if (unused.length)
    throw new Error(
      `Reviewed crate supplements no longer match the Core graph: ${unused.map((c) => `${c.name}@${c.version}`).join(', ')}`,
    );

  for (const group of reviewed.maven) {
    const files = retained(group.files);
    for (const coordinate of group.artifacts) {
      const [groupId, artifactId, artifactVersion] = coordinate.split(':');
      add({
        name: `${groupId}:${artifactId}`,
        version: artifactVersion,
        license: group.license,
        scope: 'Android libraries',
        ...(group.binaries?.[coordinate] ? { binaries: group.binaries[coordinate] } : {}),
        ...(group.notes ? { notes: group.notes } : {}),
        files,
      });
    }
  }

  const order = [
    'Application',
    'Playback and Core',
    'Stremio Core',
    'Android libraries',
    'Fonts and icons',
  ];
  components.sort(
    (a, b) =>
      order.indexOf(a.scope) - order.indexOf(b.scope) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
  writeFileSync(
    join(licenses, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        scope:
          'Kino; the release runtime classpath; the Stremio Core crate graph with its build dependencies; every native library in the APK.',
        components,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`Collected Android notices for ${components.length} components.`);
}

// The APK, not the build directory, is what people receive, so the finished package is read back.
export function verifyAndroidApk(apk) {
  const entries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' }).split('\n');
  const scratch = mkdtempSync(join(tmpdir(), 'kino-apk-notices-'));
  try {
    execFileSync('unzip', ['-q', apk, 'assets/licenses/*', '-d', scratch]);
    const licenses = join(scratch, 'assets/licenses');
    const manifest = JSON.parse(readFileSync(join(licenses, 'manifest.json'), 'utf8'));
    for (const item of manifest.components) {
      if (!item.files.length) throw new Error(`Empty notices: ${item.name}`);
      for (const f of item.files)
        if (
          !/^texts\/[a-f0-9]{64}\.(txt|html)$/.test(f.path) ||
          !existsSync(join(licenses, f.path)) ||
          hash(readFileSync(join(licenses, f.path))) !== f.sha256
        )
          throw new Error(`Invalid packaged notice: ${item.name}/${f.path}`);
    }
    const claimed = new Set(manifest.components.flatMap((c) => c.binaries ?? []));
    for (const library of entries.filter((e) => e.startsWith('lib/') && e.endsWith('.so')))
      if (!claimed.has(library)) throw new Error(`No notice inventory for ${library}`);
    const names = new Set(manifest.components.map((c) => `${c.name}:${c.version}`));
    for (const artifact of releaseArtifacts())
      if (!names.has(artifact)) throw new Error(`No notice for ${artifact}`);
    for (const required of [
      'Kino',
      'FFmpeg',
      'rust-standard-library',
      'stremio-core',
      'openssl-src',
    ])
      if (!manifest.components.some((c) => c.name === required))
        throw new Error(`Required notices missing: ${required}`);
    console.log(
      `Verified APK notices for ${manifest.components.length} components and ${claimed.size} native libraries.`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'check') {
    verifyAndroidReview();
    console.log('Reviewed Android notices match the build pins and the release classpath.');
  } else if (command === 'generate' && rest[0] === '--cargo' && rest[1])
    generateAndroidNotices(rest[1]);
  else if (command === 'verify-apk' && rest[0]) verifyAndroidApk(rest[0]);
  else
    throw new Error(
      'Usage: node scripts/android-notices.mjs check | generate --cargo <cargo> | verify-apk <apk>',
    );
}
