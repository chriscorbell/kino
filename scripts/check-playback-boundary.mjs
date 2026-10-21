#!/usr/bin/env node
// Proves that each planted way around the playback boundary (ADR 0032) fails lint or typecheck.
// It lints and typechecks files that each try one known way, in memory beside the real source,
// with the root lint config, whatever config sits nearer. Lint must report each import of a module
// closed to the planting file, each cast or type predicate aimed at a type that fences the Player
// model, each method signature in feature code (a looser view of a transport written that way
// skips its parameter checks), and each import it cannot resolve, with exactly the one rule the
// case names. tsc must refuse every form that names the Player model through the transport
// useCore() returns. Each case states both results, so the check also fails when a form starts to
// pass, when another rule starts to carry it, or when a baseline stops passing. The one plant with
// a nested lint config writes that config under a build/ directory for the run, and also goes
// through the lint script itself.
//
// It does not see a form none of the cases in test-support/playback-boundary-cases.mjs plants.
// ADR 0032 lists the forms lint and the types leave open.
//
//   node scripts/check-playback-boundary.mjs
//   node scripts/check-playback-boundary.mjs --report [repository root]   print results only
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';

import { cases } from './test-support/playback-boundary-cases.mjs';

// Plants are keyed by path, so a second case at one path would silently replace the first.
if (new Set(cases.map(({ path }) => path)).size !== cases.length)
  throw new Error('Two cases share a path.');

const reportOnly = process.argv[2] === '--report';
const root = resolve((reportOnly && process.argv[3]) || join(import.meta.dirname, '..'));
const plants = new Map(
  cases.filter((plant) => plant.tsc).map((plant) => [join(root, plant.path), plant]),
);

function judged(messages) {
  const errors = messages.filter((message) => message.severity === 2);
  const verdict = !errors.length
    ? 'pass'
    : errors.length === 1
      ? (errors[0].ruleId ?? 'parse error')
      : 'several';
  return {
    verdict,
    detail: errors.map((error) => `${error.line}: ${error.ruleId}: ${error.message}`),
  };
}

/** What `pnpm lint` reports for a plant. */
function lintScript(plant) {
  const args = ['run', '--silent', 'lint', '--format', 'json', '--stdin'];
  args.push('--stdin-filename', join(root, plant.path));
  const options = { cwd: root, encoding: 'utf8', input: plant.code };
  // pnpm is pnpm.cmd on Windows, which only a shell can launch.
  const { stdout, stderr } =
    process.platform === 'win32'
      ? spawnSync(['pnpm', ...args].join(' '), { ...options, shell: true })
      : spawnSync('pnpm', args, options);
  if (!stdout) throw new Error(`pnpm lint reported nothing for ${plant.path}.\n${stderr}`);
  return judged(JSON.parse(stdout)[0].messages);
}

/** Lints with the plant's nested config written beside it, under a build/ directory. */
function withNestedConfig(plant, run) {
  const config = join(root, dirname(plant.path), 'eslint.config.js');
  if (existsSync(config)) throw new Error(`${config} already exists.`);
  const created = mkdirSync(dirname(config), { recursive: true });
  writeFileSync(config, plant.config);
  return run().finally(() => rmSync(created ?? config, { recursive: true }));
}

async function lint() {
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.js') });
  const lintPlant = async (plant) =>
    judged((await eslint.lintText(plant.code, { filePath: join(root, plant.path) }))[0].messages);
  const results = new Map();
  for (const plant of cases) {
    if (!plant.config) {
      results.set(plant, await lintPlant(plant));
      continue;
    }
    const [own, script] = await withNestedConfig(plant, async () => [
      await lintPlant(plant),
      lintScript(plant),
    ]);
    results.set(
      plant,
      own.verdict === script.verdict
        ? own
        : {
            verdict: `${own.verdict}, pnpm lint ${script.verdict}`,
            detail: [...own.detail, ...script.detail],
          },
    );
  }
  return results;
}

function typecheck() {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, 'apps/desktop/tsconfig.app.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  const host = ts.createCompilerHost(config.options);
  const planted = (fileName) => plants.get(resolve(fileName));
  const { fileExists, getSourceFile, readFile } = host;
  host.fileExists = (fileName) => Boolean(planted(fileName)) || fileExists(fileName);
  host.readFile = (fileName) => planted(fileName)?.code ?? readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const plant = planted(fileName);
    return plant
      ? ts.createSourceFile(fileName, plant.code, languageVersion, true)
      : getSourceFile(fileName, languageVersion, ...rest);
  };
  const program = ts.createProgram({
    rootNames: [...config.fileNames, ...plants.keys()],
    options: config.options,
    host,
  });
  return new Map(
    [...plants.values()].map((plant) => {
      const source = program.getSourceFile(join(root, plant.path));
      const diagnostics = [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
      return [
        plant,
        {
          verdict: diagnostics.length ? 'fail' : 'pass',
          detail: diagnostics.map((diagnostic) => {
            const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
            return `${line + 1}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
          }),
        },
      ];
    }),
  );
}

const linted = await lint();
const typed = typecheck();
const width = Math.max(...cases.map(({ name }) => name.length));
const lintWidth = Math.max(...[...linted.values()].map(({ verdict }) => verdict.length));
console.log(`${'case'.padEnd(width)}  ${'lint'.padEnd(lintWidth)}  tsc`);
for (const plant of cases) {
  console.log(
    `${plant.name.padEnd(width)}  ${linted.get(plant).verdict.padEnd(lintWidth)}  ${typed.get(plant)?.verdict ?? '-'}`,
  );
}
if (reportOnly) process.exit(0);

const misses = cases.flatMap((plant) =>
  [
    ['lint', linted.get(plant)],
    ['tsc', typed.get(plant)],
  ]
    .filter(([check, result]) => result && result.verdict !== plant[check])
    .map(([check, { verdict, detail }]) =>
      [
        `${plant.name} (${plant.path}): expected ${check} to ${plant[check]}, it reported ${verdict}.`,
        ...detail.map((line) => `  ${line}`),
      ].join('\n'),
    ),
);
if (misses.length) {
  for (const miss of misses) console.error(miss);
  process.exit(1);
}
console.log(
  `Every one of the ${cases.length} planted cases linted and typechecked as expected: lint or tsc refuses each planted way around the playback session.`,
);
