#!/usr/bin/env node
// Checks a packaged Kino.app runs on what it carries.
//
// Read statically, every binary's load commands and search paths stay inside
// the bundle, and every bundled library is loaded by something. Then the app
// runs with dyld's library log: it loads its interface and plays a fixture, and
// neither Kino, its WebEngine process nor the streaming engine loads a file
// from outside the bundle and the system. On a Mac with Homebrew, a library the
// bundle lacks would otherwise load from Homebrew and hide the gap until the
// app reached a Mac without it.
//
//   node scripts/check-macos-package.mjs [Kino.app]

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { bundleProblems } from './macho.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const app = realpathSync(resolve(process.argv[2] ?? join(repoRoot, 'build', 'dist', 'Kino.app')));
const binary = join(app, 'Contents', 'MacOS', 'Kino');
// A clip of its own, so the check runs wherever ffmpeg does, fixtures or not.
const scratch = mkdtempSync(join(tmpdir(), 'kino-package-check-'));
const fixture = join(scratch, 'clip.mp4');
execFileSync('ffmpeg', [
  ...['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=10:size=640x360:rate=24'],
  ...['-f', 'lavfi', '-i', 'sine=duration=10'],
  ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture],
]);
const env = { ...process.env, DYLD_PRINT_LIBRARIES: '1' };

const failures = bundleProblems(app);

// dyld logs each image it maps as "dyld[pid]: <uuid> path".
function outsiders(log) {
  const paths = [...log.matchAll(/^dyld\[\d+\]: <[^>]+> (\/.*)$/gm)].map((match) => match[1]);
  if (paths.length === 0) failures.push('dyld logged no libraries; the log is not being read');
  return [
    ...new Set(
      paths.filter(
        (path) =>
          !path.startsWith(`${app}/`) &&
          !path.startsWith('/usr/lib/') &&
          !path.startsWith('/System/'),
      ),
    ),
  ];
}

async function launch() {
  const instance = `kino-package-check-${process.pid}`;
  const child = spawn(binary, [], {
    env: { ...env, KINO_INSTANCE_NAME: instance },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => (log += data));
  child.stderr.on('data', (data) => (log += data));
  const exited = once(child, 'exit');
  const deadline = Date.now() + 60_000;
  while (!log.includes('packaged UI loaded') && Date.now() < deadline && child.exitCode === null)
    await delay(100);
  const loaded = log.includes('packaged UI loaded');
  // The interface's own processes start around the load; give them time to map their libraries.
  if (loaded) await delay(3_000);
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await exited;
  clearTimeout(timer);
  // A killed Kino leaves its single-instance socket behind.
  rmSync(join(tmpdir(), instance), { force: true });
  if (!loaded) failures.push('the packaged app did not load its interface');
  for (const path of outsiders(log)) failures.push(`the app loaded ${path}`);
}

function play() {
  const run = spawnSync(binary, [], {
    env: { ...env, KINO_PLAYBACK_PROBE: fixture },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const verdict = run.stdout
    ?.split('\n')
    .findLast((line) => line.startsWith('KINO_PROBE_RESULT '))
    ?.slice('KINO_PROBE_RESULT '.length);
  const outcome = verdict ? JSON.parse(verdict).outcome : null;
  if (outcome !== 'played')
    failures.push(`the packaged app's playback ended ${outcome ?? 'without a verdict'}`);
  for (const path of outsiders(`${run.stdout ?? ''}\n${run.stderr ?? ''}`))
    failures.push(`playback loaded ${path}`);
}

// The engine maps every library it links before it runs, so a run that stops
// at its missing configuration still shows them all.
function startEngine() {
  const run = spawnSync(join(app, 'Contents', 'MacOS', 'kino-stream-engine'), [], {
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  for (const path of outsiders(`${run.stdout ?? ''}\n${run.stderr ?? ''}`))
    failures.push(`the streaming engine loaded ${path}`);
}

if (failures.length === 0) {
  await launch();
  play();
  startEngine();
}
rmSync(scratch, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`${app} does not run on what it carries:`);
  for (const failure of failures.slice(0, 30)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(
  'The packaged app loads only what it carries: its interface, a fixture and the engine ran ' +
    'without a library from outside the bundle and the system.',
);
