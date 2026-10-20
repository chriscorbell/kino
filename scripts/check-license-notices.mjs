import { verifyAndroidReview } from './android-notices.mjs';
import { describeCorePins } from './core-pins.mjs';
import { verifyReviewedNotices } from './license-notices.mjs';
import { verifyLinuxReview } from './linux-notices.mjs';
import { verifyWindowsReview } from './windows-notices.mjs';

// One bump often trips several records, such as engine.lock and the Flatpak's copy of its pin,
// so report every failure rather than the first.
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
  const messages = failures.map((error) => error.message);
  if (failures.some((error) => error.coreMoved)) messages.push(describeCorePins());
  console.error(messages.join('\n\n'));
  process.exit(1);
}
console.log(
  'Reviewed notice texts, Core WASM identity, engine locks, the Flatpak engine pin, and the Android, Linux, and Windows records match.',
);
