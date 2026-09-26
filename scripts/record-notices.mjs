// The parts of the Linux and Windows notice collectors that work the same way: a reviewed record
// per platform in third_party/notices, whose components claim the native files they account for
// by glob, and a check that reads the installed package back against it.
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

import { hash, render } from './license-notices.mjs';

const root = join(import.meta.dirname, '..');
export const reviewedRoot = join(root, 'third_party/notices');
const records = new Map();

export function record(name) {
  if (!records.has(name))
    records.set(name, JSON.parse(readFileSync(join(reviewedRoot, name), 'utf8')));
  return records.get(name);
}

// A component can take its review from another record, as "reviewed.json#qt/qtbase" or
// "linux.json#mpv", when the same release ships on both platforms. Its own fields add to that
// review: the files it claims, its scope, and notes about this platform's build.
function reused(item) {
  const [file, path] = item.reuse.split('#');
  const [group, name] = path.includes('/') ? path.split('/') : ['components', path];
  const found = record(file)[group]?.find((entry) => entry.name === name || entry.version === name);
  if (!found) throw new Error(`${item.name} reuses ${item.reuse}, which no record holds`);
  const version = found.sourceVersion ?? found.version.replace(/_\d+$/, '');
  if (version !== item.version)
    throw new Error(`${item.name} ${item.version} reuses ${item.reuse}, which reviews ${version}`);
  const { binaries: _binaries, scope: _scope, flatpakModule: _module, notes, ...review } = found;
  return {
    ...review,
    ...item,
    // This platform's notes replace the review's, which describe that platform's build.
    notes: item.notes ?? notes,
  };
}

export function components(name) {
  return record(name).components.map((item) => (item.reuse ? reused(item) : item));
}

export function verifyRecordTexts(name) {
  for (const item of components(name)) {
    if (!item.files.length) throw new Error(`No reviewed texts for ${item.name} in ${name}`);
    for (const file of item.files)
      if (hash(readFileSync(join(reviewedRoot, file.path))) !== file.sha256)
        throw new Error(`Reviewed notice changed: ${file.path}`);
  }
}

export function addRecord({ supplement, add }, name) {
  for (const item of components(name)) {
    const { reuse: _reuse, ...rest } = item;
    add(supplement(rest, item.scope));
  }
}

// The index lists components by scope and name, and its page carries every text inline: a
// sandboxed app hands the browser a single file, and one file is also the simplest to open.
export function writeNotices({ components }, licenses, scope) {
  components.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
  const manifest = { schemaVersion: 1, scope, components };
  writeFileSync(join(licenses, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(licenses, 'index.html'), render(manifest, licenses));
}

// A glob over package paths: ** crosses directories, * stays within one.
export const pattern = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*')}$`,
  );

// Regular files only: symlinks point at files the walk reaches anyway.
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

function magic(path, bytes) {
  const descriptor = openSync(path, 'r');
  try {
    const head = Buffer.alloc(bytes.length);
    return readSync(descriptor, head, 0, bytes.length, 0) === bytes.length && head.equals(bytes);
  } finally {
    closeSync(descriptor);
  }
}
export const isElf = (path) => magic(path, Buffer.from('\x7fELF', 'latin1'));
export const isPortableExecutable = (path) =>
  /\.(dll|exe)$/i.test(path) && magic(path, Buffer.from('MZ', 'latin1'));

// The installed package, not the generated directory, is what people receive. Every native file
// in it must belong to a reviewed component, every claim must still find a file, and the page
// must carry every text. Returns the package's files, as { path, packaged }, for further checks.
export function verifyPackage({ directory, prefix, licenses, isNative, skip = () => false }) {
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

  const everything = walk(directory)
    .map((path) => ({
      path,
      packaged: `${prefix}${relative(directory, path).replaceAll('\\', '/')}`,
    }))
    .filter((f) => !skip(f.packaged));
  const globs = manifest.components.flatMap((item) =>
    (item.binaries ?? []).map((glob) => ({ item, glob, match: pattern(glob) })),
  );
  const native = everything.filter((f) => isNative(f.path));
  const unclaimed = native.filter((f) => !globs.some((g) => g.match.test(f.packaged)));
  const stale = globs.filter((g) => !everything.some((f) => g.match.test(f.packaged)));
  if (unclaimed.length || stale.length)
    throw new Error(
      [
        ...unclaimed.map((f) => `No notice inventory for ${f.packaged}`),
        ...stale.map((g) => `${g.item.name} claims ${g.glob}, which the package no longer carries`),
      ].join('\n'),
    );
  const desktop = record('reviewed.json');
  const wasm = everything.filter((f) => /(^|\/)ui\/.*\.wasm$/.test(f.packaged));
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
  return { manifest, everything, native };
}
