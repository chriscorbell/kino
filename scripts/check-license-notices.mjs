import { verifyAndroidReview } from './android-notices.mjs';
import { verifyReviewedNotices } from './license-notices.mjs';
import { verifyLinuxReview } from './linux-notices.mjs';

verifyReviewedNotices();
verifyAndroidReview();
verifyLinuxReview();
console.log(
  'Reviewed notice texts, Core WASM identity, engine locks, and the Android and Linux records match.',
);
