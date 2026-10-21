import { verifyAndroidReview } from './android-notices.mjs';
import { describeCorePins } from './core-pins.mjs';
import { verifyReviewedNotices } from './license-notices.mjs';
import { verifyLinuxReview } from './linux-notices.mjs';
import { verifyWindowsReview } from './windows-notices.mjs';

// One bump often trips several records, such as engine.lock and the Flatpak's copy of its pin,
// so every verifier runs and reports what it found.
const failures = [
  verifyReviewedNotices,
  verifyAndroidReview,
  verifyLinuxReview,
  verifyWindowsReview,
].flatMap((verify) => {
  try {
    verify();
    return [];
  } catch (error) {
    return [error];
  }
});
if (failures.length) {
  // Several verifiers check the same reviewed texts, so one changed text fails each of them.
  const seen = new Set();
  const unseen = (text) => {
    const lines = text.split('\n').filter((line) => !seen.has(line));
    for (const line of lines) seen.add(line);
    return lines.join('\n');
  };
  // A plain Error is a finding; anything else is a bug in a check, and its stack says where.
  const report = (error) => (error.constructor === Error ? unseen(error.message) : error.stack);
  const messages = failures.map(report);
  if (failures.some((error) => error.coreMoved))
    try {
      messages.push(describeCorePins());
    } catch (error) {
      messages.push(report(error));
    }
  console.error(messages.filter(Boolean).join('\n\n'));
  process.exit(1);
}
console.log(
  'Reviewed notice texts, Core WASM identity, engine locks, the Flatpak engine pin, and the Android, Linux, and Windows records match.',
);
