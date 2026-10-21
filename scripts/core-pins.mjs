// Desktop and TV pin Stremio Core separately, and moving one leaves the other where it is. When a
// notices check fails on either Core, notices:check adds this description of both, so the person
// bumping one sees the other. The notice modules do not import it, because the packaging
// workflows that run them must not start on the other client's changes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { record } from './record-notices.mjs';

const root = join(import.meta.dirname, '..');

function pin(path, pattern) {
  const found = readFileSync(join(root, path), 'utf8').match(pattern)?.[1];
  if (!found) throw new Error(`${path} no longer pins Core where ${pattern} looks`);
  return found;
}

export function describeCorePins() {
  const web = pin('apps/desktop/package.json', /"@stremio\/stremio-core-web": "([^"]+)"/);
  // The installed package carries no gitHead, so the desktop's Core commit comes from the review,
  // which may be of an older package version than the one now pinned.
  const review = record('reviewed.json');
  const reviewedHead = review.coreProvenance.npm.gitHead;
  const reviewedVersion = review.core.find((item) => item.name === 'stremio-core-web').version;
  const kotlin = pin('scripts/build-android.py', /^REVISION = "([0-9a-f]+)"/m);
  const tv = pin(
    'apps/android-tv/core/Cargo.lock',
    /^name = "stremio-core"\nversion = "[^"]+"\nsource = "[^"#]+#([0-9a-f]+)"/m,
  );
  return [
    'Kino pins Stremio Core twice:',
    `  desktop: @stremio/stremio-core-web ${web} in apps/desktop/package.json, last reviewed as Core ${reviewedHead} for ${reviewedVersion}`,
    `  TV: stremio-core-kotlin ${kotlin} in scripts/build-android.py, with Core ${tv} in apps/android-tv/core/Cargo.lock`,
    'Decide whether the other client moves too.',
  ].join('\n');
}
