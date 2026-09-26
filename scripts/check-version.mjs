#!/usr/bin/env node
// Checks that built artifacts carry Kino's version from the root package.json.
//
//   node scripts/check-version.mjs                 validate the version itself
//   node scripts/check-version.mjs --app Kino.app  the macOS bundle
//   node scripts/check-version.mjs --apk Kino.apk  the TV APK (needs aapt2)
//   node scripts/check-version.mjs --exe Kino.exe  the Windows executable
//   node scripts/check-version.mjs --flatpak DIR   an installed Flatpak's files directory
//   node scripts/check-version.mjs --tag v0.1.0    a release tag
//
// The APK's versionCode is recomputed here independently of the Gradle build,
// so a mistake in either implementation fails the check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { peResources, RT_VERSION, versionInfo } from './test-support/pe.mjs';

const root = join(import.meta.dirname, '..');
const kinoVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const pattern = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+\.(\d+))?$/;

function androidVersionCode(version) {
  const match = pattern.exec(version);
  assert.ok(
    match,
    `Kino version ${version} must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-label.N`,
  );
  const [, major, minor, patch, prerelease] = match;
  const step = prerelease === undefined ? 99 : Number(prerelease);
  assert.ok(Number(minor) < 100 && Number(patch) < 100 && step >= 1 && step <= 99);
  return Number(major) * 1_000_000 + Number(minor) * 10_000 + Number(patch) * 100 + step;
}

function aapt2() {
  if (process.env.AAPT2) return process.env.AAPT2;
  const home = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools';
  const tools = join(home, 'build-tools');
  const versions = existsSync(tools) ? readdirSync(tools).sort() : [];
  assert.ok(versions.length > 0, 'Android build-tools with aapt2 are required.');
  return join(tools, versions.at(-1), 'aapt2');
}

const [flag, target] = process.argv.slice(2);
androidVersionCode(kinoVersion);
// A pre-release sorts before its release, and every step sorts upward.
assert.ok(androidVersionCode('0.2.0-beta.3') < androidVersionCode('0.2.0'));
assert.ok(androidVersionCode('0.1.9') < androidVersionCode('0.2.0-alpha.1'));
assert.ok(androidVersionCode('0.9.9') < androidVersionCode('1.0.0-rc.1'));

if (flag === '--app') {
  const plist = join(target, 'Contents', 'Info.plist');
  const read = (key) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], {
      encoding: 'utf8',
    }).trim();
  const numeric = kinoVersion.replace(/-.*$/, '');
  assert.equal(read('CFBundleShortVersionString'), numeric);
  assert.equal(read('CFBundleVersion'), numeric);
  console.log(`The macOS bundle is version ${numeric}.`);
} else if (flag === '--apk') {
  const badging = execFileSync(aapt2(), ['dump', 'badging', target], { encoding: 'utf8' });
  const name = /versionName='([^']*)'/.exec(badging)?.[1];
  const code = Number(/versionCode='(\d+)'/.exec(badging)?.[1]);
  assert.equal(name, kinoVersion);
  assert.equal(code, androidVersionCode(kinoVersion));
  console.log(`The TV APK is version ${name} (${code}).`);
} else if (flag === '--exe') {
  const resource = peResources(readFileSync(target)).find((r) => r.type === RT_VERSION);
  assert.ok(resource, `${target} carries no version resource.`);
  const info = versionInfo(resource.data);
  const numeric = kinoVersion.replace(/-.*$/, '');
  assert.equal(info.fileVersion, `${numeric}.0`);
  assert.equal(info.productVersion, `${numeric}.0`);
  assert.equal(info.strings.ProductVersion, kinoVersion);
  assert.equal(info.strings.FileVersion, numeric);
  // Windows names an unpackaged app by its description, in the media overlay among others.
  assert.equal(info.strings.FileDescription, 'Kino');
  assert.equal(info.strings.ProductName, 'Kino');
  console.log(`The Windows executable is version ${info.strings.ProductVersion}.`);
} else if (flag === '--flatpak') {
  const metainfo = readFileSync(
    join(target, 'share', 'metainfo', 'com.chriscorbell.Kino.metainfo.xml'),
    'utf8',
  );
  const release = /<release version="([^"]*)"/.exec(metainfo)?.[1];
  assert.equal(release, kinoVersion);
  console.log(`The Flatpak is version ${release}.`);
} else if (flag === '--tag') {
  assert.equal(target, `v${kinoVersion}`, 'The release tag must name the package.json version.');
  console.log(`Tag ${target} matches package.json.`);
} else {
  assert.equal(flag, undefined, `Unknown option ${flag}`);
  console.log(`Kino version ${kinoVersion} (TV versionCode ${androidVersionCode(kinoVersion)}).`);
}
