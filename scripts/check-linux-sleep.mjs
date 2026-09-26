// Puts a Linux machine to sleep for real while Kino plays, and expects Kino to
// have paused before it slept. The system-sleep case of the playback gate
// posts the notice itself; this one needs logind to send it, Kino's delay lock
// to hold the machine until the pause lands, and the machine to wake again.
//
// Run it on hardware with a desktop session, never in CI: it suspends the
// machine for about twenty seconds. It needs sudo without a password, for the
// wake alarm and because logind asks a remote session to authenticate before
// it suspends. The sleep goes through logind, as a desktop's own does, since
// writing the kernel's sleep state directly would skip logind's notice.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/linux/Kino');
assert.ok(existsSync(binary), `No Kino at ${binary}; set KINO_APP_BINARY.`);
const root = mkdtempSync(join(tmpdir(), 'kino-sleep-'));
const media = join(root, 'sleep.mp4');
const suspended = () => Number(readFileSync('/sys/power/suspend_stats/success', 'utf8'));

try {
  // Long enough that playback cannot end before the machine has slept and woken.
  execFileSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=24:duration=120',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=120',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', media,
  ]);
  const before = suspended();
  const child = spawn(binary, [], {
    env: { ...process.env, KINO_PLAYBACK_PROBE: media, KINO_PLAYBACK_PROBE_SLEEP: 'system' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let result;
  process.on('exit', () => child.kill('SIGKILL'));
  for await (const line of createInterface({ input: child.stdout })) {
    if (line === 'KINO_PROBE_AWAITING_SLEEP') {
      execFileSync('sudo', ['-n', 'rtcwake', '-m', 'no', '-s', '20'], { stdio: 'ignore' });
      execFileSync('sudo', ['-n', 'systemctl', 'suspend']);
      console.log('Asked logind to suspend with a wake alarm in 20 seconds.');
    } else if (line.startsWith('KINO_PROBE_RESULT ')) {
      result = JSON.parse(line.slice('KINO_PROBE_RESULT '.length));
    }
  }
  assert.ok(result, 'Kino gave no verdict.');
  // Kino answers as soon as it pauses, which should be before the machine
  // sleeps, so the sleep itself is counted once the machine is awake again.
  const deadline = Date.now() + 60_000;
  while (suspended() === before && Date.now() < deadline) await delay(500);
  assert.ok(suspended() > before, 'The machine never slept, so nothing was checked.');
  console.log(`Kino paused after ${result.asleepBeforePauseMs} ms asleep.`);
  assert.equal(result.outcome, 'paused-for-sleep', `Kino reported ${result.outcome} rather than pausing for sleep.`);
  // Asleep time at the pause: a pause after waking would carry the whole sleep.
  assert.ok(
    result.asleepBeforePauseMs >= 0 && result.asleepBeforePauseMs < 1000,
    `Kino paused after ${result.asleepBeforePauseMs} ms asleep, so not before sleeping.`,
  );
  console.log('Kino paused before a real sleep and woke paused.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
