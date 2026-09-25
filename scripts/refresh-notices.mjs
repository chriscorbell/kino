#!/usr/bin/env node
// Carries a reviewed Homebrew notice supplement forward to a new release, but only when the review
// still holds: every retained text must come back byte for byte from the new release's own source,
// and every text extracted from a source file must still appear in it verbatim. Anything else is
// written out for a person to review and the entry is left alone.
//
//   node scripts/refresh-notices.mjs <formula> [<formula>...]
//   node scripts/refresh-notices.mjs --accept <formula>   after reviewing the changed texts
//   node scripts/refresh-notices.mjs --release <formula>  for the release Homebrew ships now
//
// The new version is the installed keg's, the same one packaging reads. CI installs whatever
// Homebrew ships, so a formula can move there before it moves on this machine; --release reads the
// current formula from homebrew-core instead of the local keg, which it leaves alone. Nothing is
// trusted from a cache: each archive is downloaded again and its SHA256 recorded.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const noticesDir = join(root, 'third_party', 'notices');
const reviewedPath = join(noticesDir, 'reviewed.json');
const cache = join(root, 'build', 'notices-cache');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The version and Ruby source Homebrew ships now, read without updating or installing anything. */
async function releasedFormula(formula) {
  const response = await fetch(`https://formulae.brew.sh/api/formula/${formula}.json`);
  assert.ok(response.ok, `Homebrew has no formula ${formula}`);
  const info = await response.json();
  const version = info.versions.stable + (info.revision ? `_${info.revision}` : '');
  const source = await fetch(
    `https://raw.githubusercontent.com/Homebrew/homebrew-core/HEAD/${info.ruby_source_path}`,
  );
  assert.ok(source.ok, `Cannot read the ${formula} formula`);
  const ruby = await source.text();
  assert.ok(
    ruby.includes(info.versions.stable),
    `The ${formula} formula no longer describes ${info.versions.stable}`,
  );
  return { version, ruby };
}

function installedVersion(formula) {
  const info = JSON.parse(
    execFileSync('brew', ['info', '--json=v2', formula], { encoding: 'utf8' }),
  );
  const installed = info.formulae[0]?.installed?.at(-1)?.version;
  assert.ok(installed, `${formula} is not installed`);
  return installed;
}

/**
 * Revisions the formula's stable build vendors as resources, by GitHub repository. A release can
 * move them without its own URL changing, so pinned-commit texts follow these, not the old pins.
 */
function resourceRevisions(
  formula,
  ruby = execFileSync('brew', ['cat', formula], { encoding: 'utf8' }),
) {
  const stable = ruby.split(/^\s*head do/m)[0];
  const revisions = new Map();
  for (const match of stable.matchAll(
    /url\s+"https:\/\/github\.com\/([^/"]+\/[^/".]+)(?:\.git)?",\s*revision:\s*"([0-9a-f]{40})"/g,
  ))
    revisions.set(match[1].toLowerCase(), match[2]);
  return revisions;
}

/** Points a commit-pinned GitHub URL at the revision the new formula vendors. */
function repinned(url, revisions) {
  const pinned =
    /^https:\/\/(?:raw\.githubusercontent\.com|github\.com)\/([^/]+\/[^/]+)\/(?:tree\/)?([0-9a-f]{40})/.exec(
      url,
    );
  const revision = pinned && revisions.get(pinned[1].toLowerCase());
  return revision ? url.replace(pinned[2], revision) : url;
}

function sourceVersion(version) {
  return version.replace(/_\d+$/, '');
}

/** The same source location at the new release. GNOME also files releases by major.minor. */
function moved(url, from, to) {
  const series = (version) => version.split('.').slice(0, 2).join('.');
  return url.replaceAll(`/${series(from)}/`, `/${series(to)}/`).replaceAll(from, to);
}

async function download(url) {
  mkdirSync(cache, { recursive: true });
  const target = join(cache, `${sha256(url).slice(0, 16)}-${basename(new URL(url).pathname)}`);
  if (!existsSync(target)) {
    const response = await fetch(url, { redirect: 'follow' });
    assert.ok(response.ok, `${url} returned ${response.status}`);
    writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  return target;
}

async function fetchText(source) {
  const [location, member] = source.split('#');
  if (member) {
    const archive = await download(location);
    return { bytes: execFileSync('tar', ['-xOf', archive, member]), archive };
  }
  const blob = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(location);
  const raw = blob
    ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`
    : location;
  return { bytes: readFileSync(await download(raw)) };
}

const reviewed = JSON.parse(readFileSync(reviewedPath, 'utf8'));
const accept = process.argv.includes('--accept');
const release = process.argv.includes('--release');
let failed = false;
for (const formula of process.argv.slice(2).filter((argument) => !argument.startsWith('--'))) {
  const entry = reviewed.homebrew.find((item) => item.name === formula);
  assert.ok(entry, `No reviewed supplement for ${formula}`);
  const released = release ? await releasedFormula(formula) : null;
  const version = released?.version ?? installedVersion(formula);
  if (entry.version === version) {
    console.log(`${formula} ${version} is already reviewed.`);
    continue;
  }
  const from = entry.sourceVersion ?? sourceVersion(entry.version);
  const to = sourceVersion(version);
  const revisions = resourceRevisions(formula, released?.ruby);
  const changed = [];
  const statements = [];
  const files = [];
  const archives = new Map();
  for (const file of entry.files) {
    const source = repinned(from === to ? file.source : moved(file.source, from, to), revisions);
    // Repository pointers record a pinned revision, not a text to compare.
    if (/\/tree\/[0-9a-f]{40}$/.test(source)) {
      files.push(file);
      continue;
    }
    const { bytes, archive } = await fetchText(source);
    if (archive) archives.set(source.split('#')[0], archive);
    const retained = readFileSync(join(noticesDir, file.path));
    // A Kino-written statement about the release, such as the IJG credit, names its versions.
    // Only those names move; the printed text must still be checked against the new formula.
    if (file.extraction && retained.includes(from) && !bytes.includes(retained)) {
      const text = retained
        .toString('utf8')
        .replaceAll(entry.version, version)
        .replaceAll(from, to);
      const hash = sha256(Buffer.from(text));
      writeFileSync(join(noticesDir, 'texts', `${hash}.txt`), text);
      statements.push(`${file.name}:\n${text}`);
      files.push({ ...file, source, sha256: hash, path: `texts/${hash}.txt` });
      continue;
    }
    const holds = file.extraction ? bytes.includes(retained) : sha256(bytes) === file.sha256;
    // A person has read the changed text and it still carries the same terms.
    if (!holds && accept && !file.extraction) {
      const hash = sha256(bytes);
      writeFileSync(join(noticesDir, 'texts', `${hash}.txt`), bytes);
      files.push({ ...file, source, sha256: hash, path: `texts/${hash}.txt` });
      console.log(`${formula}: accepted the reviewed ${file.name} from ${source}`);
      continue;
    }
    if (!holds) {
      const review = join(noticesDir, 'review', `${formula}-${version}`);
      mkdirSync(review, { recursive: true });
      writeFileSync(join(review, file.name), bytes);
      changed.push(`${file.name} (${source})`);
    }
    files.push({ ...file, source });
  }
  if (changed.length) {
    failed = true;
    console.error(
      `${formula} ${version}: these texts changed and need review before the supplement moves:\n  ` +
        changed.join('\n  ') +
        `\nNew copies are in third_party/notices/review/${formula}-${version}/.`,
    );
    continue;
  }
  entry.version = version;
  if (entry.sourceVersion) entry.sourceVersion = to;
  entry.files = files;
  if (entry.sourceArchive) {
    entry.sourceArchive = moved(entry.sourceArchive, from, to);
    const archive = archives.get(entry.sourceArchive) ?? (await download(entry.sourceArchive));
    entry.sourceArchiveSha256 = sha256(readFileSync(archive));
  }
  if (entry.archive?.url) {
    entry.archive.url = moved(entry.archive.url, from, to);
    entry.archive.path = moved(entry.archive.path, from, to);
    entry.archive.sha256 = sha256(readFileSync(await download(entry.archive.url)));
  }
  console.log(`${formula}: the supplement moved to ${version}.`);
  for (const statement of statements)
    console.log(`Check this rewritten statement against the ${version} formula:\n${statement}`);
}
writeFileSync(reviewedPath, JSON.stringify(reviewed, null, 2) + '\n');
// Keep the manifest in the repository's own format so the web check stays green.
execFileSync('pnpm', ['exec', 'prettier', '--write', reviewedPath], { cwd: root, stdio: 'ignore' });
if (failed) process.exit(1);
