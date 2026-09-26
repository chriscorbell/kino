import { verifyAndroidReview } from './android-notices.mjs';
import { verifyReviewedNotices } from './license-notices.mjs';
import { verifyLinuxReview } from './linux-notices.mjs';
import { verifyWindowsReview } from './windows-notices.mjs';

verifyReviewedNotices();
verifyAndroidReview();
verifyLinuxReview();
verifyWindowsReview();
console.log(
  'Reviewed notice texts, Core WASM identity, engine locks, and the Android, Linux, and Windows records match.',
);
