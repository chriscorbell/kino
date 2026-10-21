#!/usr/bin/env node
// Fails when a gate could stop running without anyone noticing: a scripts/check-* file that no
// check step, workflow job, or CTest a workflow runs ever calls; a gate without its own package
// script; or a file a workflow reads that the workflow's path filter misses, so a change to it
// skips the job that would have caught the break. Six macOS gates sat unrun until #204, and
// #272 found the native filter missing a script packaging imports.
//
// The same reading decides whether CI's native jobs run: the files they read are computed here,
// so a new probe or helper needs no filter edit.
//
//   node scripts/check-gate-wiring.mjs [repository root]
//   node scripts/check-gate-wiring.mjs --native-inputs        print what the native jobs read
//   node scripts/check-gate-wiring.mjs --native-changed BASE HEAD
//
// The wiring is read from the files as they stand, by pattern rather than by parsing YAML. It
// traces local imports of JavaScript and TypeScript, and the scripts/ paths named in scripts,
// workflow, CMake and package text. It does not see a path built at run time, and the files a
// script reads by path outside scripts/ are listed in SCRIPT_READS.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const [mode, ...rest] = process.argv[2]?.startsWith('--')
  ? process.argv.slice(2)
  : ['--check', ...process.argv.slice(2)];
const root = (mode === '--native-changed' ? undefined : rest[0]) ?? join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const isFile = (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile();

const SCRIPT_REF = /scripts\/[\w./-]+\.(?:mjs|js|sh|py|cpp)\b/g;
const PNPM_RUN = /\bpnpm (?:run )?([\w:-]+)/g;
const RUNNER = /\brun-check\.mjs(?:[ \t]+(\w+))?/g;
const CLIENT_BUILD = /--filter @kino\/desktop build/;
const BY_HAND = /^(?:\/\/|#) Gate: by hand, \S/m;
// Selecting tests would make every add_test script count as run when only some are. Short flags
// can carry their value glued on, as in -Rname, so they take no word boundary.
const CTEST_FILTER =
  /\s(?:-[REILN]|--(?:(?:tests|exclude|label)-[\w-]+|show-only|preset|rerun-failed)\b)/;
// vitest runs only in the web job, which every change runs.
const UNIT_TESTS = ['!apps/desktop/**/*.test.ts', '!apps/desktop/**/*.test.tsx'];
const SCRIPT_READS = {
  'scripts/android-notices.mjs': [
    'LICENSE',
    'apps/android-tv/app/gradle.lockfile',
    'apps/android-tv/core/Cargo.lock',
  ],
  'scripts/build-engine.sh': ['apps/stream-engine/**'],
  'scripts/check-version.mjs': ['package.json'],
  'scripts/license-notices.mjs': ['LICENSE', 'third_party/notices/**'],
  'scripts/linux-notices.mjs': [
    'apps/stream-engine/engine.lock',
    'packaging/flatpak/com.chriscorbell.Kino.yml',
  ],
};

const pkg = JSON.parse(read('package.json'));
const scripts = pkg.scripts;

const filesIn = (text, seen = new Set()) => [
  ...(text.match(SCRIPT_REF) ?? []),
  ...[...text.matchAll(PNPM_RUN)].flatMap(([, name]) => packageFiles(name, seen)),
  ...[...text.matchAll(RUNNER)].flatMap(([, list = 'checkSteps']) =>
    (pkg[list] ?? []).flatMap((step) => packageFiles(step, seen)),
  ),
];
function packageFiles(name, seen = new Set()) {
  if (!scripts[name] || seen.has(name)) return [];
  seen.add(name);
  return filesIn(scripts[name], seen);
}

const checked = new Set(packageFiles('check'));
const packaged = new Set(
  Object.values(scripts).flatMap((command) => command.match(SCRIPT_REF) ?? []),
);

// The client the shell bundles, with the workspace packages it depends on.
const workspace = new Map(
  readdirSync(join(root, 'packages'))
    .filter((dir) => isFile(`packages/${dir}/package.json`))
    .map((dir) => [JSON.parse(read(`packages/${dir}/package.json`)).name, `packages/${dir}/**`]),
);
const client = [
  'apps/desktop/**',
  'tsconfig.base.json',
  ...Object.keys(JSON.parse(read('apps/desktop/package.json')).dependencies ?? {})
    .filter((name) => workspace.has(name))
    .map((name) => workspace.get(name)),
];

// CMake configure reads every repository path the build files name outside add_test, so every job
// that builds the shell reads it; a script named inside add_test runs only where a job runs ctest.
const cmake = { configure: new Set(['apps/macos-shell/**']), ctest: new Set() };
const ADD_TEST = /\badd_test\s*\([^)]*\)/gi;
const CMAKE_PATH = /\$\{(CMAKE_CURRENT_SOURCE_DIR|KINO_REPOSITORY_ROOT)\}\/([\w./*-]+)/g;
const cmakePaths = (text) =>
  [...text.matchAll(CMAKE_PATH)]
    .map(([, base, path]) =>
      posix.normalize(base === 'KINO_REPOSITORY_ROOT' ? path : `apps/macos-shell/${path}`),
    )
    .filter((path) => !/^(?:\.|\.\.\/.*|apps\/macos-shell\/.*|build\/.*)$/.test(path));
for (const file of readdirSync(join(root, 'apps/macos-shell'), { recursive: true })) {
  if (!/(?:^|\/)CMakeLists\.txt$|\.cmake$/.test(file)) continue;
  const source = read(join('apps/macos-shell', file)).replace(/^\s*#.*$/gm, '');
  for (const path of cmakePaths(source.match(ADD_TEST)?.join('\n') ?? '')) cmake.ctest.add(path);
  for (const path of cmakePaths(source.replace(ADD_TEST, ''))) cmake.configure.add(path);
  if (CLIENT_BUILD.test(source)) client.forEach((glob) => cmake.configure.add(glob));
}

function readWorkflow(path) {
  const lines = read(path)
    .split('\n')
    .map((line) => line.replace(/(?:^|\s)#.*$/, ''))
    .filter((line) => line.trim());
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
    job.via = inputsOf(job.runs);
    const reads = (files, reason) => files.forEach((f) => job.via.has(f) || job.via.set(f, reason));
    reads([path], null);
    if (/\bpnpm install\b/.test(job.body))
      reads(['.npmrc', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'], 'pnpm install');
    for (const [, file] of job.body.matchAll(/node-version-file:\s*(\S+)/g)) reads([file], null);
    if (CLIENT_BUILD.test(job.body)) reads(client, 'the client build');
  }
  return { path, pathLists, jobs };
}

// Every file the given files read, each mapped to the file that led to it. A glob such as a
// directory is kept as it stands. So is a path that no longer exists: something still names it, so
// deleting or renaming it away is a change to what the job reads.
function inputsOf(files) {
  const via = new Map();
  const visit = (file, parent) => {
    if (via.has(file)) return;
    via.set(file, parent);
    if (file.includes('*') || !isFile(file)) return;
    const next = [...(SCRIPT_READS[file] ?? [])];
    if (/^scripts\/.*\.(?:sh|py|mjs|js)$/.test(file))
      next.push(...(read(file).match(SCRIPT_REF) ?? []));
    if (/\.(?:mjs|js|ts|tsx)$/.test(file))
      for (const [, spec] of read(file).matchAll(
        /\b(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g,
      )) {
        const path = posix.join(dirname(file), spec);
        next.push(
          [
            path,
            path.replace(/\.js$/, '.ts'),
            ...['.ts', '.tsx', '/index.ts'].map((e) => path + e),
          ].find(isFile) ?? path,
        );
      }
    for (const n of next) visit(n, file);
  };
  for (const file of files) visit(file, null);
  return via;
}

const globMatch = (glob, file) =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '\0')
        .replace(/\*\*/g, '\x01')
        .replace(/\*/g, '[^/]*')
        .replace(/\0/g, '(?:.*/)?')
        .replace(/\x01/g, '.*') +
      '$',
  ).test(file);
// As GitHub reads a paths list: the last pattern that matches decides, and ! excludes.
const matches = (globs, file) =>
  globs.reduce(
    (hit, glob) =>
      glob.startsWith('!') ? hit && !globMatch(glob.slice(1), file) : hit || globMatch(glob, file),
    false,
  );

const workflows = readdirSync(join(root, '.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .map((name) => readWorkflow(`.github/workflows/${name}`));

const nativeInputs = [
  ...new Set(
    workflows.flatMap((wf) =>
      wf.jobs.filter((job) => job.native).flatMap((job) => [...job.via.keys()]),
    ),
  ),
]
  .sort()
  .concat(UNIT_TESTS);

if (mode === '--native-inputs') {
  console.log(nativeInputs.filter((input) => /\*/.test(input) || isFile(input)).join('\n'));
  process.exit(0);
}
if (mode === '--native-changed') {
  const [base, head] = rest;
  // A new branch has no base to compare, so everything may have changed.
  if (!base || /^0+$/.test(base)) {
    console.log('native=true');
    process.exit(0);
  }
  const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file && matches(nativeInputs, file));
  for (const file of changed) console.error(`native input changed: ${file}`);
  console.log(`native=${changed.length > 0}`);
  process.exit(0);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const filesOf = (glob) =>
  glob.includes('*')
    ? tracked.filter((file) => matches([glob, ...UNIT_TESTS], file))
    : [glob].filter(isFile);

const gates = readdirSync(join(root, 'scripts'))
  .filter((name) => name.startsWith('check-'))
  .map((name) => `scripts/${name}`);
const ranInCI = new Set(workflows.flatMap((wf) => wf.jobs.flatMap((job) => job.runs)));

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
for (const wf of workflows) {
  if (
    wf.jobs.some((job) => job.native) &&
    !wf.jobs.some((job) => /check-gate-wiring\.mjs --native-changed\b/.test(job.body))
  )
    problems.push(
      `${wf.path} gates jobs on the changes job, but no job runs \`node scripts/check-gate-wiring.mjs --native-changed\` to decide it.`,
    );
  for (const job of wf.jobs.filter((job) => job.ctestFilter))
    problems.push(
      `${wf.path} runs \`${job.ctestFilter}\`, which selects tests, so this check cannot tell which add_test scripts it runs. Run the whole suite there, or teach this check to resolve the selection.`,
    );
  const reads = new Map(wf.jobs.flatMap((job) => [...job.via]));
  for (const { event, globs } of wf.pathLists)
    for (const [input, parent] of reads) {
      const missed = filesOf(input).find((file) => !matches(globs, file));
      if (!missed) continue;
      const through = parent ? ` through ${parent}` : '';
      problems.push(
        `${missed} is read by ${wf.path}${through}, but its ${event} paths miss it. Add ${input} to that list.`,
      );
    }
}

for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(`Gate wiring: ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(`${gates.length} gates are wired, and every path filter covers what its jobs read.`);
