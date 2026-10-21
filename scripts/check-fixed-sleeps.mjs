#!/usr/bin/env node
// Fails when a change adds a fixed sleep to gate code without saying why. A sleep that stands in
// for a condition passes on a fast machine and fails on a slow one: #111's fullscreen probe slept
// 750 ms for a macOS animation and failed on hosted runners until the sleep grew to 2 s, and the
// next slow runner would have failed that too. Waiting for the condition itself, under a deadline,
// is the fix. A sleep in the body of a loop bounded by a deadline, or by the shell's seq, is that
// wait's poll interval and passes. Another sleep that is right, such as a settle before a negative assertion
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
  // The same resolve wrapped in an arrow that only calls it.
  /\bsetTimeout\(\s*\(\)\s*=>\s*\{?\s*[\w.]+\(\)/,
  // Thread.sleep, SystemClock.sleep, time.sleep, coroutine and promise delay(), and Qt's and the
  // C++ library's thread sleeps.
  /\b(?:sleep|delay|msleep|usleep|sleep_for|qWait)\s*\(\s*[^)\s]/,
  // Android's Handler, which runs the rest of the test after a fixed delay.
  /\bpostDelayed\s*\(/,
  // The shell's sleep, alone or after an operator, a keyword, or timeout.
  /(?:^|[;&|(]|\b(?:then|do|else)\b|\btimeout\s+\S+)\s*sleep\s+["']?[\d.$]/,
];
const EXCUSED = /sleep-ok:\s*\S/;
// The header of a loop that ends at a deadline or after a fixed number of tries, read without its
// comment so that a comment cannot excuse a sleep.
const POLL_LOOP = /\b(?:while|for|until)\b.*(?:deadline|Date\.now|currentTimeMillis|\bseq\b)/i;
const LOOKBACK = 5;

const isSleep = (text) => SLEEPS.some((pattern) => pattern.test(text));
const indent = (text) => text.match(/^\s*/)[0].length;
const pollLoop = (text) => POLL_LOOP.test(text.split(/\s(?:\/\/|#)/)[0]);

// Whether lines[i] is a sleep the check reports. The lines above it count only while they are the
// lines just above it in the same file. Walking up, a line indented less than everything below it
// so far encloses the sleep; one indented as far or further is a sibling, so a loop that ended
// above the sleep does not excuse it.
function reported(lines, i) {
  const { file, number, text } = lines[i];
  if (!isSleep(text) || EXCUSED.test(text) || pollLoop(text)) return false;
  let floor = indent(text);
  for (let j = i - 1; j >= Math.max(0, i - LOOKBACK); j--) {
    const above = lines[j];
    if (above.file !== file || above.number !== number - (i - j)) break;
    if (j === i - 1 && EXCUSED.test(above.text) && !isSleep(above.text)) return false;
    if (!above.text.trim() || indent(above.text) >= floor) continue;
    if (pollLoop(above.text)) return false;
    floor = indent(above.text);
  }
  return true;
}

// Each case is a snippet and whether the check must report its last line.
const cases = [
  ['await new Promise((resolve) => setTimeout(resolve, 2000));', true],
  ['await new Promise((resolve) => setTimeout(resolve, 2000)); // sleep-ok: settle', false],
  ['// sleep-ok: settle\nawait new Promise((resolve) => setTimeout(resolve, 2000));', false],
  ['await new Promise((resolve) => setTimeout(resolve, 2000)); // sleep-ok:', true],
  ['await delay(500); // sleep-ok: settle\nawait delay(500);', true],
  ['await new Promise((resolve) => setTimeout(() => resolve(), 500));', true],
  ['await new Promise((r) => setTimeout(() => r(), n));', true],
  ['await new Promise((resolve) => setTimeout(() => { resolve(); }, 500));', true],
  ['await setTimeout(500);', true],
  ['await delay(1500);', true],
  ['Thread.sleep(80)', true],
  ['SystemClock.sleep(300)', true],
  ['delay(300)', true],
  ['handler.postDelayed({ latch.countDown() }, 500)', true],
  ['time.sleep(0.5)', true],
  ['std::this_thread::sleep_for(std::chrono::milliseconds(50));', true],
  ['sleep 2', true],
  ['open -a Kino && sleep 1', true],
  ['timeout 5 sleep 1', true],
  ['while true; do sleep 1; done', true],
  ['sleep "$interval"', true],
  ['await delay(3000); // wait for the deadline to pass', true],
  ['Thread.sleep(500) // until deadline', true],
  ['const timer = setTimeout(() => reject(new Error("timed out")), 5000);', false],
  ['clearTimeout(timer);', false],
  ['withTimeout(15_000) { awaitCondition() }', false],
  ['while (Date.now() < deadline) {\n  if (done()) break;\n  await delay(100);', false],
  ['while (!done() && Date.now() < deadline) await delay(500);', false],
  [
    'while (System.currentTimeMillis() < deadline) {\n    if (met) return\n    Thread.sleep(100)',
    false,
  ],
  ['for _ in $(seq 1 50); do\n  kill -0 "$pid" || break\n  sleep 0.1', false],
  [
    'while (System.currentTimeMillis() < deadline) {\n    if (playing) {\n        Thread.sleep(100)',
    false,
  ],
  [
    'while (!loaded && Date.now() < deadline)\n  await delay(100);\nconst loaded = check();\nif (loaded) await delay(3_000);',
    true,
  ],
  ['for (code in keys) {\n    send(code)\n    Thread.sleep(400)', true],
  ['repeat(2) {\n    send(KEYCODE_DPAD_DOWN)\n    Thread.sleep(600)', true],
  [
    'while (Date.now() < deadline) {\n  a();\n  b();\n  c();\n  d();\n  e();\n  await delay(100);',
    true,
  ],
];
const missed = cases.filter(([snippet, flagged]) => {
  const lines = snippet.split('\n').map((text, i) => ({ file: 'planted', number: i + 1, text }));
  return reported(lines, lines.length - 1) !== flagged;
});
if (missed.length) {
  for (const [snippet, flagged] of missed)
    console.error(
      `Planted case: the last line of "${snippet}" must ${flagged ? '' : 'not '}be reported.`,
    );
  process.exit(1);
}

const { label, lines } = changedLines('fixed-sleeps', GATE_CODE, LOOKBACK);
const problems = lines
  .filter((line, i) => line.added && reported(lines, i))
  .map(
    ({ file, number }) =>
      `${file}:${number}: a fixed sleep. Wait for the condition under a deadline, or say why this sleep is right with "sleep-ok: <reason>" on the line or the one above.`,
  );

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
