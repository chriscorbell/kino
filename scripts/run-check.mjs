#!/usr/bin/env node
// Runs every step in a package.json step list, checkSteps unless another is named, and keeps going
// after a failure, so one run names every failed step in its last lines.
//
//   node scripts/run-check.mjs [list]
//
// checkSteps run a few at a time with each step's output held until it ends. Any other list is a
// native probe list: probes start the app, so they run one at a time and print as they go, which
// keeps a hung probe's output in the CI log when the job times out.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { availableParallelism, constants } from 'node:os';

const root = new URL('..', import.meta.url);
const list = process.argv[2] ?? 'checkSteps';
const steps = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))[list];
if (!Array.isArray(steps)) throw new Error(`package.json has no step list named ${list}`);
const live = list !== 'checkSteps';
const name = live ? list : 'check';
const cores = availableParallelism();
const concurrency = live ? 1 : Math.min(4, cores);
// vitest sets the pace of the whole run, so it starts first. Left alone it starts a worker per
// core, and beside the other steps that has filled the memory of a 15 GB machine.
const testWorkers = Math.max(1, Math.min(8, cores - 1));
const stepArgs = { test: [`--maxWorkers=${testWorkers}`] };
// intro:check asserts a five-second deadline lands within a window a loaded machine can miss.
const alone = new Set(['intro:check']);

const queue = steps
  .filter((step) => !alone.has(step))
  .sort((a, b) => (b === 'test') - (a === 'test'));
const results = new Map();
const started = performance.now();
const secondsSince = (since) => ((performance.now() - since) / 1000).toFixed(1);

const windows = process.platform === 'win32';
const running = new Set();

// Off Windows each step leads its own process group, so one kill reaches the whole step tree.
function killStep(child, signal) {
  try {
    if (windows) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The step's group is already gone.
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    for (const child of running) killStep(child, signal);
    process.exit(128 + constants.signals[signal]);
  });
}

async function run(step) {
  const since = performance.now();
  const args = ['run', '--silent', step, ...(stepArgs[step] ?? [])];
  const output = live ? 'inherit' : 'pipe';
  const options = { cwd: root, stdio: ['ignore', output, output], detached: !windows };
  // pnpm is pnpm.cmd on Windows, which only a shell can launch, and Node warns when a shell gets
  // an argument list.
  const child = windows
    ? spawn(['pnpm', ...args].join(' '), { ...options, shell: true })
    : spawn('pnpm', args, options);
  const closed = new Promise((resolve) => child.once('close', resolve));
  let held = '';
  for (const stream of live ? [] : [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (data) => (held += data));
  }
  running.add(child);
  const exit = await once(child, 'exit').then(
    ([code, signal]) => code ?? signal,
    (error) => ((held += error.message), error.code),
  );
  // A grandchild that outlives the step still holds its pipes, and close waits for it.
  if (child.pid) killStep(child, 'SIGKILL');
  await closed;
  running.delete(child);
  const seconds = secondsSince(since);
  results.set(step, { exit, seconds });
  console.log(`${exit === 0 ? 'ok  ' : 'FAIL'} ${step} (${seconds}s)`);
  if (exit !== 0 && held) console.log(held.trimEnd().replace(/^/gm, '  | '));
}

console.log(
  live
    ? `${list}: ${steps.length} steps, one at a time`
    : `check: ${steps.length} steps, ${concurrency} at a time, vitest on ${testWorkers} workers`,
);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
for (const step of steps.filter((step) => alone.has(step))) await run(step);

const failed = steps.filter((step) => results.get(step).exit !== 0);
for (const step of failed) {
  const { exit, seconds } = results.get(step);
  console.log(`FAIL ${step} (exit ${exit}, ${seconds}s): rerun with pnpm ${step}`);
}
const total = secondsSince(started);
console.log(
  failed.length
    ? `${name} failed: ${failed.length} of ${steps.length} steps in ${total}s: ${failed.join(', ')}`
    : `${name} passed: ${steps.length} steps in ${total}s`,
);
if (failed.length) process.exitCode = 1;
