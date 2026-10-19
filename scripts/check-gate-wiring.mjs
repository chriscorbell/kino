#!/usr/bin/env node
// Fails when a gate could stop running without anyone noticing: a scripts/check-* file that no
// check step, workflow job, or CTest a workflow runs ever calls; a gate without its own package
// script; or a file a workflow reads that the workflow's path filter misses, so a change to it
// skips the job that would have caught the break. Six macOS gates sat unrun until #204, and
// #272 found the native filter missing a script packaging imports.
//
//   node scripts/check-gate-wiring.mjs [repository root]
//
// The wiring is read from the files as they stand, by pattern rather than by parsing YAML. It
// traces local imports of JavaScript scripts, and the scripts/ paths named in shell, Python,
// workflow, CMake and package text. It does not trace scripts/ paths in string literals inside
// JavaScript, reads of third_party/ or packaging/, or a path built at run time.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.argv[2] ?? join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const SCRIPT_REF = /scripts\/[\w./-]+\.(?:mjs|js|sh|py)\b/g;
const PNPM_RUN = /\bpnpm (?:run )?([\w:-]+)/g;
const BY_HAND = /^(?:\/\/|#) Gate: by hand, \S/m;
// Selecting tests would make every add_test script count as run when only some are. Short flags
// can carry their value glued on, as in -Rname, so they take no word boundary.
const CTEST_FILTER =
  /\s(?:-[REILN]|--(?:(?:tests|exclude|label)-[\w-]+|show-only|preset|rerun-failed)\b)/;

const pkg = JSON.parse(read('package.json'));
const scripts = pkg.scripts;

const filesIn = (text, seen = new Set()) => [
  ...(text.match(SCRIPT_REF) ?? []),
  ...[...text.matchAll(PNPM_RUN)].flatMap(([, name]) => packageFiles(name, seen)),
];
function packageFiles(name, seen = new Set()) {
  if (!scripts[name] || seen.has(name)) return [];
  seen.add(name);
  return filesIn(scripts[name], seen);
}

const checkSteps = pkg.checkSteps ?? [...scripts.check.matchAll(PNPM_RUN)].map(([, name]) => name);
const checked = new Set(checkSteps.flatMap((step) => packageFiles(step)));
const packaged = new Set(
  Object.values(scripts).flatMap((command) => command.match(SCRIPT_REF) ?? []),
);

// CMake configure runs any script the build files name outside add_test, so every job that builds
// the shell reads it; a script named inside add_test runs only where a job runs ctest.
const cmake = { configure: new Set(), ctest: new Set() };
const ADD_TEST = /\badd_test\s*\([^)]*\)/gi;
for (const file of readdirSync(join(root, 'apps/macos-shell'), { recursive: true })) {
  if (!/(?:^|\/)CMakeLists\.txt$|\.cmake$/.test(file)) continue;
  const source = read(join('apps/macos-shell', file)).replace(/^\s*#.*$/gm, '');
  for (const ref of source.match(ADD_TEST)?.join('\n').match(SCRIPT_REF) ?? [])
    cmake.ctest.add(ref);
  for (const ref of source.replace(ADD_TEST, '').match(SCRIPT_REF) ?? []) cmake.configure.add(ref);
}

function readWorkflow(path) {
  const lines = read(path)
    .split('\n')
    .map((line) => line.replace(/(?:^|\s)#.*$/, ''))
    .filter((line) => line.trim());
  const text = lines.join('\n');
  const jobsAt = lines.indexOf('jobs:');
  const trigger = lines.slice(0, jobsAt);

  const pathLists = [];
  trigger.forEach((line, i) => {
    const key = line.match(/^(\s*)paths:\s*(.*)$/);
    if (!key) return;
    const event = trigger
      .slice(0, i)
      .findLast((l) => /^\s*[\w-]+:/.test(l) && l.search(/\S/) < key[1].length)
      .trim()
      .slice(0, -1);
    const rest = trigger.slice(i + 1);
    const flow = [key[2], ...rest].join(' ').trim();
    const items = flow.startsWith('[')
      ? flow.slice(1, flow.indexOf(']')).split(',')
      : rest
          .slice(
            0,
            rest.findIndex((l) => !/^\s+- /.test(l)),
          )
          .map((l) => l.replace(/^\s+- /, ''));
    pathLists.push({
      event,
      globs: items.map((g) => g.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
    });
  });

  const jobs = [];
  for (const line of lines.slice(jobsAt + 1)) {
    if (/^ {2}[\w-]+:\s*$/.test(line)) jobs.push({ body: '' });
    else if (jobs.length) jobs.at(-1).body += line + '\n';
  }
  for (const job of jobs) {
    const runs = filesIn(job.body);
    const ctestLines = job.body
      .replace(/\s*\\\n\s*/g, ' ')
      .split('\n')
      .filter((line) => /\bctest\b/.test(line));
    const ctest = ctestLines.length > 0;
    job.ctestFilter = ctestLines
      .find((line) => CTEST_FILTER.test(line))
      ?.trim()
      .replace(/^run:\s*/, '');
    const buildsShell =
      ctest ||
      runs.includes('scripts/build-macos.sh') ||
      /cmake -S apps\/macos-shell|flatpak-builder/.test(job.body);
    job.native = /needs\.changes\.outputs\.native\b/.test(job.body);
    job.runs = [...runs, ...(buildsShell ? cmake.configure : []), ...(ctest ? cmake.ctest : [])];
  }

  // The changes job's `const xPaths = /^.../;` filters, whose union decides whether native jobs run.
  const filters = [...text.matchAll(/const (\w+Paths) = \/(\^.*)\/;/g)].map(([, name, source]) => ({
    name,
    pattern: new RegExp(source),
  }));
  return { path, pathLists, filters, jobs };
}

// Client sources Vite bundles are not imports of any script, so the workflows' filters cover them
// with a directory glob.
function inputsOf(files) {
  const via = new Map();
  const visit = (file, parent) => {
    if (via.has(file) || !existsSync(join(root, file))) return;
    via.set(file, parent);
    let next = [];
    if (/^scripts\/.*\.(?:sh|py)$/.test(file)) next = read(file).match(SCRIPT_REF) ?? [];
    else if (/^scripts\/.*\.(?:mjs|js)$/.test(file))
      next = [...read(file).matchAll(/\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g)].map(
        ([, spec]) => relative(root, join(root, dirname(file), spec)),
      );
    for (const n of next) visit(n, file);
  };
  for (const file of files) visit(file, null);
  return via;
}

const globMatch = (glob, file) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\0')
        .replace(/\*/g, '[^/]*')
        .replace(/\0/g, '.*') +
      '$',
  ).test(file);

const workflows = readdirSync(join(root, '.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => readWorkflow(`.github/workflows/${name}`));
const ranInCI = new Set(workflows.flatMap((wf) => wf.jobs.flatMap((job) => job.runs)));
const gates = readdirSync(join(root, 'scripts'))
  .filter((name) => name.startsWith('check-'))
  .map((name) => `scripts/${name}`);

const problems = [];
for (const gate of gates) {
  const comment = gate.endsWith('.py') || gate.endsWith('.sh') ? '#' : '//';
  const head = read(gate).split('\n').slice(0, 15).join('\n');
  if (!checked.has(gate) && !ranInCI.has(gate) && !BY_HAND.test(head))
    problems.push(
      `${gate} runs nowhere. Add its package script to the check steps or to a CI job, or put "${comment} Gate: by hand, <reason>" in its first lines.`,
    );
  // A CTest gate takes the probe CMake built as its argument, so `ctest -R` is its entry point.
  if (!packaged.has(gate) && !cmake.ctest.has(gate))
    problems.push(`${gate} has no package script. Add a package.json script that runs it.`);
}
const through = (via, file) => (via.get(file) ? ` through ${via.get(file)}` : '');
for (const wf of workflows) {
  if (wf.jobs.some((job) => job.native) && !wf.filters.length)
    problems.push(
      `${wf.path} gates jobs on the changes job, but no \`const xPaths = /^...$/;\` filter was found in it. Keep the filter in that form, or teach this check its new one.`,
    );
  for (const job of wf.jobs.filter((job) => job.ctestFilter))
    problems.push(
      `${wf.path} runs \`${job.ctestFilter}\`, which selects tests, so this check cannot tell which add_test scripts it runs. Run the whole suite there, or teach this check to resolve the selection.`,
    );
  if (wf.filters.length) {
    const via = inputsOf(wf.jobs.filter((job) => job.native).flatMap((job) => job.runs));
    const names = wf.filters.map((f) => f.name).join(' or ');
    for (const file of via.keys())
      if (!wf.filters.some((f) => f.pattern.test(file)))
        problems.push(
          `${file} is read by ${wf.path}'s native jobs${through(via, file)}, but ${names} misses it. Add it to ${names} in the changes job.`,
        );
  }
  if (wf.pathLists.length) {
    const via = inputsOf(wf.jobs.flatMap((job) => job.runs));
    for (const { event, globs } of wf.pathLists)
      for (const file of via.keys())
        if (!globs.some((glob) => globMatch(glob, file)))
          problems.push(
            `${file} is read by ${wf.path}${through(via, file)}, but its ${event} paths miss it. Add ${file} to that list.`,
          );
  }
}

for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(`Gate wiring: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`${gates.length} gates are wired, and every path filter covers what its jobs read.`);
