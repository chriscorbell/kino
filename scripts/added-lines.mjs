// The lines a change adds, for checks that hold new code to a rule old code is not yet held to.
//
// With no arguments the range runs from the merge base with origin/main to the working tree. In
// CI it is the checked-out commit's first parent to the commit: the pull request's base for the
// merge commit GitHub checks out, and the previous commit for a push to main. A check's own
// arguments, BASE [HEAD], override both.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const git = (...args) =>
  execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

function range(check) {
  const args = process.argv.slice(2, 4);
  if (args.length) return args;
  if (process.env.GITHUB_ACTIONS === 'true') {
    // The first parent is the base. The web job checks out two commits so that the checks that
    // read it, which run at once, need not each fetch it into the same repository.
    try {
      git('rev-parse', '--verify', '--quiet', 'HEAD^1');
    } catch {
      try {
        git(
          'fetch',
          '--no-tags',
          '--quiet',
          '--depth=2',
          'origin',
          git('rev-parse', 'HEAD').trim(),
        );
      } catch {
        console.error(`Could not fetch the base commit for the ${check} check.`);
        process.exit(1);
      }
    }
    return ['HEAD^1', 'HEAD'];
  }
  try {
    return [git('merge-base', 'origin/main', 'HEAD').trim()];
  } catch {
    console.error(
      `No origin/main to compare against. Fetch it, or pass a base: node scripts/check-${check}.mjs BASE`,
    );
    process.exit(1);
  }
}

// Each line of every hunk in the files the pathspecs select, as { file, number, text, added }.
// context unchanged lines around each hunk come too, marked added: false.
export function changedLines(check, pathspecs, context = 0) {
  const [base, head] = range(check);
  const short = (rev) => git('rev-parse', '--short', rev).trim();
  const label = `${short(base)}..${head ? short(head) : 'working tree'}`;
  // A pass over an empty range would look like a clean change.
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    git('rev-list', '--count', `${base}..${head}`).trim() === '0'
  ) {
    console.error(`The ${check} check's range ${label} looks empty, so it would check nothing.`);
    process.exit(1);
  }
  const diff = git(
    'diff',
    '--no-color',
    '--no-ext-diff',
    '-M',
    `--unified=${context}`,
    ...[base, head].filter(Boolean),
    '--',
    ...pathspecs,
  );
  const lines = [];
  let file;
  let number;
  let inHeader = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) inHeader = true;
    if (inHeader && line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    const hunk = line.match(/^@@ -\S+ \+(\d+)/);
    if (hunk) {
      inHeader = false;
      number = Number(hunk[1]);
    }
    if (inHeader || !/^[+ ]/.test(line)) continue;
    lines.push({ file, number: number++, text: line.slice(1), added: line[0] === '+' });
  }
  return { label, lines };
}
