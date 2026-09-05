#!/usr/bin/env node

// Exercise the real vendor/build script with a local Git upstream. Only the
// native toolchain is stubbed, so this check also runs in the Linux web CI job.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = mkdtempSync(join(tmpdir(), 'kino-vendor-check-'));
const upstream = join(root, 'upstream');
const project = join(root, 'project');
const engine = join(project, 'apps/stream-engine');
const vendor = join(project, 'build/vendor/stream-server');
const bin = join(root, 'bin');
const cargoArgs = join(root, 'cargo-args');
const patchFile = join(engine, 'patches/0001-change.patch');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function git(args, cwd = upstream) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function patch(before, after) {
  writeFileSync(
    patchFile,
    `diff --git a/value.txt b/value.txt
--- a/value.txt
+++ b/value.txt
@@ -1 +1 @@
-${before}
+${after}
`,
  );
}

function build() {
  rmSync(cargoArgs, { force: true });
  return spawnSync('bash', [join(project, 'scripts/build-engine.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, KINO_VENDOR_PROBE_ARGS: cargoArgs },
  });
}

function expectValue(value) {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(vendor, 'value.txt'), 'utf8'), `${value}\n`);
}

try {
  for (const directory of [upstream, join(project, 'scripts'), join(engine, 'patches'), bin]) {
    mkdirSync(directory, { recursive: true });
  }
  copyFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'build-engine.sh'),
    join(project, 'scripts/build-engine.sh'),
  );
  git(['init', '--quiet']);
  writeFileSync(join(upstream, 'value.txt'), 'original\n');
  writeFileSync(join(upstream, '.gitignore'), '*.ignored\n');
  git(['add', '.']);
  git([
    '-c',
    'user.name=Kino check',
    '-c',
    'user.email=kino@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '-m',
    'Fixture',
  ]);
  const revision = git(['rev-parse', 'HEAD']);
  writeFileSync(
    join(engine, 'engine.lock'),
    `KINO_ENGINE_REPOSITORY=${quote(upstream)}\nKINO_ENGINE_REVISION=${revision}\n`,
  );
  for (const [name, body] of Object.entries({
    cargo: 'printf "%s\\n" "$@" > "$KINO_VENDOR_PROBE_ARGS"',
    'pkg-config': 'exit 0',
    brew: 'printf "/unused\\n"',
  })) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }

  patch('original', 'first patch');
  expectValue('first patch');
  patch('original', 'edited patch');
  expectValue('edited patch');
  console.log('Patch edits apply at the same upstream revision.');

  writeFileSync(join(vendor, 'value.txt'), 'local contamination\n');
  writeFileSync(join(vendor, 'extra.txt'), 'untracked\n');
  writeFileSync(join(vendor, 'extra.ignored'), 'ignored\n');
  expectValue('edited patch');
  assert.ok(!existsSync(join(vendor, 'extra.txt')));
  assert.ok(!existsSync(join(vendor, 'extra.ignored')));
  console.log('Local vendor changes are reconstructed from committed inputs.');

  patch('does not match', 'broken patch');
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = build();
    assert.notEqual(result.status, 0, 'A failed patch must fail again on retry.');
    assert.ok(!existsSync(cargoArgs), 'Cargo must not run after a failed patch.');
  }
  patch('original', 'repaired patch');
  expectValue('repaired patch');
  console.log('Failed patches block every attempt until repaired.');

  rmSync(patchFile);
  expectValue('original');
  assert.ok(readFileSync(cargoArgs, 'utf8').split('\n').includes('--locked'));
  console.log('Removed patches disappear, and Cargo uses the recorded lockfile.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
