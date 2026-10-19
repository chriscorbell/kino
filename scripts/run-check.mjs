#!/usr/bin/env node
// Runs every step in package.json's checkSteps, a few at a time, and keeps going after a failure,
// so one run names every failed step in its last lines.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { availableParallelism, constants } from 'node:os';

const root = new URL('..', import.meta.url);
const { checkSteps } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const cores = availableParallelism();
const concurrency = Math.min(4, cores);
// vitest sets the pace of the whole run, so it starts first. Left alone it starts a worker per
// core, and beside the other steps that has filled the memory of a 15 GB machine.
const testWorkers = Math.max(1, Math.min(8, cores - 1));
const stepArgs = { test: [`--maxWorkers=${testWorkers}`] };
// intro:check asserts a five-second deadline lands within a window a loaded machine can miss.
const alone = new Set(['intro:check']);

const queue = checkSteps
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
  const options = { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: !windows };
  // pnpm is pnpm.cmd on Windows, which only a shell can launch, and Node warns when a shell gets
  // an argument list.
  const child = windows
    ? spawn(['pnpm', ...args].join(' '), { ...options, shell: true })
    : spawn('pnpm', args, options);
  const closed = new Promise((resolve) => child.once('close', resolve));
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8');
    stream.on('data', (data) => (output += data));
  }
  running.add(child);
  const exit = await once(child, 'exit').then(
    ([code, signal]) => code ?? signal,
    (error) => ((output += error.message), error.code),
  );
  // A grandchild that outlives the step still holds its pipes, and close waits for it.
  if (child.pid) killStep(child, 'SIGKILL');
  await closed;
  running.delete(child);
  const seconds = secondsSince(since);
  results.set(step, { exit, seconds });
  console.log(`${exit === 0 ? 'ok  ' : 'FAIL'} ${step} (${seconds}s)`);
  if (exit !== 0) console.log(output.trimEnd().replace(/^/gm, '  | '));
}

console.log(
  `check: ${checkSteps.length} steps, ${concurrency} at a time, vitest on ${testWorkers} workers`,
);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (queue.length) await run(queue.shift());
  }),
);
for (const step of checkSteps.filter((step) => alone.has(step))) await run(step);

const failed = checkSteps.filter((step) => results.get(step).exit !== 0);
for (const step of failed) {
  const { exit, seconds } = results.get(step);
  console.log(`FAIL ${step} (exit ${exit}, ${seconds}s): rerun with pnpm ${step}`);
}
const total = secondsSince(started);
console.log(
  failed.length
    ? `check failed: ${failed.length} of ${checkSteps.length} steps in ${total}s: ${failed.join(', ')}`
    : `check passed: ${checkSteps.length} steps in ${total}s`,
);
if (failed.length) process.exitCode = 1;
