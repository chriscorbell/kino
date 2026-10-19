#!/usr/bin/env node
// Records the notice bundle for Qt modules at a release, for a person to review before it ships.
// Each bundle holds the module's LICENSES texts and licenseRule.json from the release tag, then
// Qt's published third-party attribution pages for the module's documentation groups, rendered to
// text. Homebrew moves Qt on its own schedule and its kegs carry no third-party notices, so a new
// Qt release needs a new bundle; refresh-notices.mjs cannot carry one forward.
//
//   node scripts/review-qt-notices.mjs <version> <formula>...
//
// The documentation groups come from the formula's newest existing review. A new review is added
// beside the old ones, which another record may still reuse for a platform that builds that Qt.
// It refuses Qt WebEngine, whose bundle also carries the pinned Chromium license files and lists
// a page its WebEngine and PDF groups share only once; this tool does neither.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hash as sha256 } from './license-notices.mjs';

const root = join(import.meta.dirname, '..');
const noticesDir = join(root, 'third_party', 'notices');
const reviewedPath = join(noticesDir, 'reviewed.json');
const rule = '='.repeat(78);

async function get(url) {
  const response = await fetch(url);
  assert.ok(response.ok, `${url} returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function tagRevision(repository, version) {
  const lines = execFileSync(
    'git',
    ['ls-remote', `https://github.com/${repository}.git`, `refs/tags/v${version}^{}`],
    { encoding: 'utf8' },
  ).trim();
  const revision = lines.split(/\s/)[0];
  assert.match(revision, /^[0-9a-f]{40}$/, `${repository} has no v${version} tag`);
  return revision;
}

function decode(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

const blockTag =
  /^<\/?(?:h[1-6]|p|div|pre|li|ul|ol|table|tr|td|th|thead|tbody|blockquote|dl|dt|dd|br)\b/;

/**
 * An attribution page as text: the title, then the description with each run of adjacent tags
 * that contains a block element turned into one line break and source whitespace kept, so the
 * license texts inside <pre> come through verbatim. This reproduces the Qt 6.11.2 review's texts
 * byte for byte from the same pages.
 */
export function attributionText(html, url) {
  const title = html.match(/<h1 class="title">([\s\S]*?)<\/h1>/)?.[1];
  const start = html.indexOf('<div class="descr"');
  const end = html.indexOf('<!-- @@@', start);
  assert.ok(title && start >= 0 && end > start, `${url} is not a Qt attribution page`);
  const description = html.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
  const body = description.replace(/(?:<[^>]+>)+/g, (run) =>
    run.match(/<[^>]+>/g).some((tag) => blockTag.test(tag)) ? '\n' : '',
  );
  const links = [
    ...new Set(
      [...description.matchAll(/href="([^"]+)"/g)]
        .map((match) => decode(match[1]))
        .map((href) => (/^[a-z]+:/i.test(href) ? href : new URL(href, url).href)),
    ),
  ].sort();
  const name = decode(title);
  return { name, text: `${name}\n\n\n\n${decode(body).trim()}\n`, links };
}

function attributionPages(index, docs, modules) {
  const pages = [];
  for (const group of index.split(/<h2 /).slice(1)) {
    const module = decode(group.match(/^[^>]*>([^<]+)/)[1]);
    if (!modules.includes(module)) continue;
    for (const match of group.matchAll(/<td class="tblName"[^>]*><p><a href="([^"#]+)"/g))
      pages.push({ module, url: new URL(match[1], docs).href });
  }
  return pages.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

export async function qtBundle({ formula, version, modules, retrieved, docs }) {
  const repository = `qt/${formula}`;
  const revision = tagRevision(repository, version);
  const tree = `https://github.com/${repository}/tree/${revision}`;
  const listing = JSON.parse(
    await get(`https://api.github.com/repos/${repository}/contents/LICENSES?ref=${revision}`),
  );
  const paths = [...listing.map((item) => item.path), 'licenseRule.json'].sort();
  const sections = [];
  const licenseArtifacts = [];
  for (const path of paths) {
    const source = `https://raw.githubusercontent.com/${repository}/${revision}/${path}`;
    const bytes = await get(source);
    const artifact = {
      repository,
      version,
      revision,
      source,
      path: `pinned/${formula}/${path}`,
      sha256: sha256(bytes),
      bytes: bytes.length,
    };
    licenseArtifacts.push(artifact);
    sections.push(
      `${artifact.path}\nSource: ${source}\nSHA256: ${artifact.sha256}\n\n${bytes.toString('utf8')}`,
    );
  }
  const index = (await get(new URL('licenses-used-in-qt.html', docs).href)).toString('utf8');
  assert.ok(index.includes(`Qt ${version}`), `${docs} does not document Qt ${version}`);
  const attributionArtifacts = [];
  for (const { module, url } of attributionPages(index, docs, modules)) {
    const html = await get(url);
    const page = attributionText(html.toString('utf8'), url);
    const text =
      `Qt ${version} upstream third-party notice: ${page.name}\nQt modules: ${module}\n` +
      `Source: ${url}\nRetrieved: ${retrieved}\n\n${page.text}` +
      (page.links.length ? `\nReferenced upstream links:\n${page.links.join('\n')}\n` : '');
    attributionArtifacts.push({
      module,
      name: page.name,
      url,
      modules: [module],
      htmlSha256: sha256(html),
      textSha256: sha256(text),
      bytes: Buffer.byteLength(text),
      links: page.links,
    });
    sections.push(text);
  }
  const preamble =
    `Qt ${formula} ${version}\n\n` +
    'This product includes Qt software developed by The Qt Company Ltd and other contributors.\n' +
    `Source release: ${tree}\n\n` +
    `The license texts below were copied from the pinned Qt ${version} source repository.\n` +
    'Source file SPDX identifiers identify the licenses that apply to individual Qt files.\n' +
    `The third-party notices were captured from Qt's official ${version} documentation on\n` +
    `${retrieved}. These module-wide notices also cover optional components and other\n` +
    'platforms. Separately linked Homebrew libraries have their own bundled notices.\n\n';
  const bundle = Buffer.from(
    preamble + sections.map((section) => `${rule}\n${section}\n\n`).join(''),
  );
  return { bundle, revision, tree, licenseArtifacts, attributionArtifacts };
}

if (process.argv[1] === import.meta.filename) {
  const [version, ...formulae] = process.argv.slice(2);
  assert.ok(version && formulae.length, 'Usage: review-qt-notices.mjs <version> <formula>...');
  assert.ok(
    !formulae.includes('qtwebengine'),
    'qtwebengine needs its pinned Chromium license files and deduplicated pages; review it by hand.',
  );
  const reviewed = JSON.parse(readFileSync(reviewedPath, 'utf8'));
  const docs = `https://doc.qt.io/qt-${version.split('.').slice(0, 2).join('.')}/`;
  const retrieved = new Date().toISOString().slice(0, 10);
  for (const formula of formulae) {
    const previous = reviewed.qt.findLast((entry) => entry.name === formula);
    assert.ok(previous, `No reviewed Qt bundle for ${formula}`);
    const { modules } = previous.provenance;
    const made = await qtBundle({ formula, version, modules, retrieved, docs });
    const hash = sha256(made.bundle);
    const name = `${formula}-${version}-NOTICES.txt`;
    writeFileSync(join(noticesDir, 'texts', `${hash}.txt`), made.bundle);
    const entry = {
      name: formula,
      version,
      repository: made.tree,
      license: previous.license,
      files: [{ path: `texts/${hash}.txt`, source: made.tree, sha256: hash, name }],
      provenance: {
        formula,
        version,
        modules,
        source: made.tree,
        sourceRevision: made.revision,
        file: `bundles/${name}`,
        sha256: hash,
        bytes: made.bundle.length,
        licenseArtifacts: made.licenseArtifacts,
        attributionArtifacts: made.attributionArtifacts,
      },
    };
    reviewed.qt = reviewed.qt.filter(
      (item) => !(item.name === formula && item.version === version),
    );
    reviewed.qt.push(entry);
    console.log(
      `${formula} ${version}: ${made.licenseArtifacts.length} license texts and ` +
        `${made.attributionArtifacts.length} attribution pages in texts/${hash}.txt`,
    );
  }
  writeFileSync(reviewedPath, JSON.stringify(reviewed, null, 2) + '\n');
  execFileSync('pnpm', ['exec', 'prettier', '--write', reviewedPath], {
    cwd: root,
    stdio: 'ignore',
  });
}
