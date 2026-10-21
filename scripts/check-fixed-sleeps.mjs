#!/usr/bin/env node
// Fails when a change adds a fixed sleep to gate code without saying why. A sleep that stands in
// for a condition passes on a fast machine and fails on a slow one: #111's fullscreen probe slept
// 750 ms for a macOS animation and failed on hosted runners until the sleep grew to 2 s, and the
// next slow runner would have failed that too. Waiting for the condition itself, under a deadline,
// is the fix. A sleep that is right, such as a poll interval, a settle before a negative assertion,
// or a long press, carries `sleep-ok: <reason>` on its line or the line above.
//
//   node scripts/check-fixed-sleeps.mjs               lines added since the merge base with origin/main
//   node scripts/check-fixed-sleeps.mjs BASE [HEAD]   lines added between two commits
//
// Only added lines count. The sleeps already in gate code predate the rule.
import { changedLines } from './added-lines.mjs';

const GATE_CODE = [
  'scripts/check-*',
  'scripts/test-support',
  'apps/android-tv/app/src/androidTest',
  ':(exclude)scripts/check-fixed-sleeps.mjs',
];
const SLEEPS = [
  // A promise's resolve handed to setTimeout, or node:timers/promises' setTimeout(ms).
  /\bsetTimeout\(\s*[\w.]+\s*[,)]/,
  // Thread.sleep, SystemClock.sleep, time.sleep, coroutine and promise delay(), and Qt's and the
  // C++ library's thread sleeps.
  /\b(?:sleep|delay|msleep|usleep|sleep_for|qWait)\s*\(\s*[^)\s]/,
  // The shell's sleep.
  /^\s*sleep\s+[\d.$]/,
];
const EXCUSED = /sleep-ok:\s*\S/;

const unexcused = (text, above = '') =>
  SLEEPS.some((pattern) => pattern.test(text)) && !EXCUSED.test(text) && !EXCUSED.test(above);

// Each case is a line, the line above it, and whether the check must report it.
const cases = [
  ['await new Promise((resolve) => setTimeout(resolve, 2000));', '', true],
  ['await new Promise((resolve) => setTimeout(resolve, 2000)); // sleep-ok: settle', '', false],
  ['await new Promise((resolve) => setTimeout(resolve, 2000));', '// sleep-ok: settle', false],
  ['await new Promise((resolve) => setTimeout(resolve, 2000)); // sleep-ok:', '', true],
  ['await setTimeout(500);', '', true],
  ['await delay(1500);', '', true],
  ['Thread.sleep(80)', '', true],
  ['SystemClock.sleep(300)', '', true],
  ['delay(300)', '', true],
  ['time.sleep(0.5)', '', true],
  ['std::this_thread::sleep_for(std::chrono::milliseconds(50));', '', true],
  ['sleep 2', '', true],
  ['const timer = setTimeout(() => reject(new Error("timed out")), 5000);', '', false],
  ['clearTimeout(timer);', '', false],
  ['withTimeout(15_000) { awaitCondition() }', '', false],
];
const missed = cases.filter(([text, above, flagged]) => unexcused(text, above) !== flagged);
if (missed.length) {
  for (const [text, above, flagged] of missed)
    console.error(
      `Planted case: "${text}"${above ? ` under "${above}"` : ''} must ${flagged ? '' : 'not '}be reported.`,
    );
  process.exit(1);
}

const { label, lines } = changedLines('fixed-sleeps', GATE_CODE, 1);
const problems = [];
lines.forEach(({ file, number, text, added }, i) => {
  const above = lines[i - 1]?.file === file && lines[i - 1].number === number - 1;
  if (added && unexcused(text, above ? lines[i - 1].text : ''))
    problems.push(
      `${file}:${number}: a fixed sleep. Wait for the condition under a deadline, or say why this sleep is right with "sleep-ok: <reason>" on the line or the one above.`,
    );
});

for (const problem of problems) console.error(problem);
if (problems.length) {
  console.error(
    `Fixed sleeps: ${problems.length} unexplained sleep${problems.length === 1 ? '' : 's'} in gate code.`,
  );
  process.exit(1);
}
const added = lines.filter((line) => line.added).length;
console.log(
  `Examined ${added} added line${added === 1 ? '' : 's'} of gate code, ${label}; the ${cases.length} planted cases read as expected.`,
);
