// Reads the load commands of a Mach-O file, which is all packaging needs to
// know about a binary: its own install name, the libraries it loads, where it
// looks for them, and the UUID that identifies its build. Reading them here,
// rather than running file(1), otool(1) and dwarfdump(1) once per file, keeps
// packaging from spending minutes starting processes.

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const CPU_TYPE_ARM64 = 0x0100000c;

const LC_ID_DYLIB = 0xd;
const LC_RPATH = 0x8000001c;
const LC_UUID = 0x1b;
const LOAD_COMMANDS = new Set([
  0xc, // LC_LOAD_DYLIB
  0x20, // LC_LAZY_LOAD_DYLIB
  0x80000018, // LC_LOAD_WEAK_DYLIB
  0x8000001f, // LC_REEXPORT_DYLIB
  0x80000023, // LC_LOAD_UPWARD_DYLIB
]);

export const MH_EXECUTE = 2;
export const MH_DYLIB = 6;
export const MH_BUNDLE = 8;

function read(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const count = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, count);
}

// The arm64 slice of a thin or universal binary, as { type, id, uuid, dylibs, rpaths },
// or null for anything that is not Mach-O.
export function readMachO(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch {
    return null;
  }
  try {
    let start = 0;
    let head = read(fd, 0, 32);
    if (head.length < 32) return null;
    const fat = head.readUInt32BE(0);
    if (fat === FAT_MAGIC || fat === FAT_MAGIC_64) {
      const count = head.readUInt32BE(4);
      // A Java class file shares the universal magic; its "count" is a version number.
      if (count === 0 || count > 16) return null;
      const size = fat === FAT_MAGIC ? 20 : 32;
      const table = read(fd, 8, count * size);
      for (let i = 0; i < count; i += 1) {
        if (table.readUInt32BE(i * size) !== CPU_TYPE_ARM64) continue;
        start =
          fat === FAT_MAGIC
            ? table.readUInt32BE(i * size + 8)
            : Number(table.readBigUInt64BE(i * size + 8));
      }
      if (!start) return null;
      head = read(fd, start, 32);
    }
    if (head.length < 32 || head.readUInt32LE(0) !== MH_MAGIC_64) return null;
    const type = head.readUInt32LE(12);
    const commandCount = head.readUInt32LE(16);
    const commands = read(fd, start + 32, head.readUInt32LE(20));

    const string = (at) => commands.toString('utf8', at, commands.indexOf(0, at));
    const binary = { type, id: null, uuid: null, dylibs: [], rpaths: [] };
    let at = 0;
    for (let i = 0; i < commandCount; i += 1) {
      const command = commands.readUInt32LE(at);
      const size = commands.readUInt32LE(at + 4);
      if (command === LC_ID_DYLIB) binary.id = string(at + commands.readUInt32LE(at + 8));
      else if (LOAD_COMMANDS.has(command))
        binary.dylibs.push(string(at + commands.readUInt32LE(at + 8)));
      else if (command === LC_RPATH) binary.rpaths.push(string(at + commands.readUInt32LE(at + 8)));
      else if (command === LC_UUID)
        binary.uuid = commands
          .toString('hex', at + 8, at + 24)
          .toUpperCase()
          .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
      at += size;
    }
    return binary;
  } finally {
    closeSync(fd);
  }
}

// The files and directories under root. Links are not followed: a bundle's
// links point back into it, and one of them can close a loop.
export function walk(root) {
  const files = [];
  const directories = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
        visit(path);
      } else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return { files, directories };
}

export function machOFiles(root) {
  return walk(root).files.filter((path) => readMachO(path));
}

const isSystem = (path) => path.startsWith('/usr/lib/') || path.startsWith('/System/');

// What would make a packaged app load something it does not carry, or carry
// something nothing loads. On a Mac with Homebrew, a library the bundle lacks
// would otherwise still load from Homebrew and hide the gap.
export function bundleProblems(bundle) {
  const app = resolve(bundle);
  const contents = join(app, 'Contents');
  const problems = [];
  const loaded = new Set();
  const binaries = machOFiles(app);
  for (const binary of binaries) {
    const name = relative(app, binary);
    const { dylibs, rpaths } = readMachO(binary);
    const searched = [];
    for (const path of rpaths) {
      const directory = /^@loader_path(\/|$)/.test(path)
        ? resolve(dirname(binary), path.slice('@loader_path/'.length))
        : null;
      if (directory?.startsWith(`${contents}/`)) searched.push(directory);
      else problems.push(`${name} searches ${path}`);
    }
    for (const dylib of dylibs) {
      if (isSystem(dylib)) continue;
      const found = dylib.startsWith('@rpath/')
        ? searched
            .map((directory) => join(directory, dylib.slice('@rpath/'.length)))
            .find(existsSync)
        : null;
      if (found) loaded.add(realpathSync(found));
      else problems.push(`${name} loads ${dylib}, which the bundle does not carry`);
    }
  }
  // Qt opens plugins at run time rather than linking them, and the WebEngine
  // helper is started, not loaded.
  for (const binary of binaries) {
    if (!binary.startsWith(join(contents, 'Frameworks') + '/')) continue;
    if (readMachO(binary).type === MH_EXECUTE) continue;
    if (!loaded.has(realpathSync(binary))) problems.push(`nothing loads ${relative(app, binary)}`);
  }
  // A QML module whose plugin is missing fails only when something imports it.
  const qml = join(contents, 'Resources', 'qml');
  if (existsSync(qml))
    for (const path of walk(qml).files) {
      if (basename(path) !== 'qmldir') continue;
      const module = dirname(path);
      for (const [, plugin] of readFileSync(path, 'utf8').matchAll(/^(?:optional )?plugin (\S+)/gm))
        if (!existsSync(join(module, `lib${plugin}.dylib`)))
          problems.push(`${relative(app, module)} names plugin ${plugin}, which is missing`);
    }
  return problems;
}
