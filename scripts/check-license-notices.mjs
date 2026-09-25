import { verifyAndroidReview } from './android-notices.mjs';
import { verifyReviewedNotices } from './license-notices.mjs';

verifyReviewedNotices();
verifyAndroidReview();
console.log(
  'Reviewed notice texts, Core WASM identity, engine locks, and the Android record match.',
);
