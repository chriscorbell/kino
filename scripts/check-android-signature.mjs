#!/usr/bin/env node
// Checks that an APK is signed with Kino's release certificate, whose SHA-256 fingerprint is
// committed in apps/android-tv/release-certificate.sha256. Android installs an update only over an
// app signed with the same certificate, so a release signed with anything else could never update
// the TV app people already have.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const [apk] = process.argv.slice(2);
assert.ok(apk, 'Usage: node scripts/check-android-signature.mjs <apk>');
const pinned = join(root, 'apps', 'android-tv', 'release-certificate.sha256');
assert.ok(
  existsSync(pinned),
  'No release certificate is pinned; run scripts/setup-android-release-key.sh',
);
const expected = readFileSync(pinned, 'utf8').trim().toLowerCase().replaceAll(':', '');

const home = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools';
const tools = join(home, 'build-tools');
const version = readdirSync(tools).sort().at(-1);
const output = execFileSync(join(tools, version, 'apksigner'), ['verify', '--print-certs', apk], {
  encoding: 'utf8',
});
const certificates = [...output.matchAll(/certificate SHA-256 digest: ([0-9a-f]{64})/g)].map(
  (match) => match[1],
);
assert.deepEqual(certificates, [expected], `${apk} is not signed with Kino's release certificate`);
console.log(`${apk} is signed with Kino's release certificate.`);
