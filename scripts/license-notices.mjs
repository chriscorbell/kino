// Collect actual installed dependency texts without network access. Reviewed
// supplements fill omissions in published packages and generated Qt credits.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reviewedRoot = join(root, 'third_party/notices');
const reviewed = JSON.parse(readFileSync(join(reviewedRoot, 'reviewed.json'), 'utf8'));
export const hash = (data) => createHash('sha256').update(data).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const noticeName =
  /^(licen[cs]e(?:s)?(?:$|[._-])|copying(?:$|[._-])|copyright(?:$|[._-])|notice(?:s)?(?:$|[._-])|authors(?:$|[._-])|patents(?:$|[._-])|legal(?:$|[._-])|[al]?gpl[-.]|bsd[-.]|mit\.txt$|ftl\.txt$|readme\.ijg$)/i;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    if (entry.isSymbolicLink()) {
      const linked = join(directory, entry.name);
      return existsSync(linked) && statSync(linked).isFile() ? [linked] : [];
    }
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function noticeFiles(directory, recursive = true) {
  if (!existsSync(directory)) return [];
  return (
    recursive ? walk(directory) : readdirSync(directory).map((name) => join(directory, name))
  ).filter(
    (path) =>
      statSync(path).isFile() &&
      (noticeName.test(basename(path)) || /[/\\]LICENSES?[/\\]/i.test(path)) &&
      !/\.(rs|c|h|py|pl|pm|sh|cfg|ts|tsx|js|mjs|cjs)$/i.test(path),
  );
}

export function verifyReviewedNotices() {
  for (const group of ['core', 'engine', 'qt', 'homebrew', 'rust']) {
    for (const item of reviewed[group]) {
      if (!item.files.length) throw new Error(`No reviewed texts for ${item.name}`);
      for (const file of item.files) {
        if (hash(readFileSync(join(reviewedRoot, file.path))) !== file.sha256)
          throw new Error(`Reviewed notice changed: ${file.path}`);
      }
    }
  }
  const core = createRequire(join(root, 'apps/desktop/package.json')).resolve(
    '@stremio/stremio-core-web',
  );
  if (
    hash(readFileSync(join(dirname(core), 'stremio_core_web_bg.wasm'))) !==
    reviewed.coreProvenance.wasm.sha256
  )
    throw new Error('Core WASM changed. Review its source graph and notices.');
  for (const [path, expected] of [
    ['apps/stream-engine/Cargo.lock', reviewed.engineLockSha256],
    ['apps/stream-engine/engine.lock', reviewed.engineSourceSha256],
  ]) {
    if (hash(readFileSync(join(root, path))) !== expected)
      throw new Error(`${path} changed. Review engine notice supplements.`);
  }
}

// The pieces every desktop collector shares: texts are stored once by content hash under
// texts/, and every component must carry at least one.
export const kinoSources = [
  'LICENSE',
  'apps/macos-shell/UPSTREAM.md',
  'apps/stream-engine/engine.lock',
  'third_party/notices/README.md',
];

export function noticeCollector(output) {
  mkdirSync(join(output, 'texts'), { recursive: true });
  const components = [];
  function file(path, source, name = basename(path), extra = {}) {
    const data = readFileSync(path);
    const sha256 = hash(data);
    const target = `texts/${sha256}${path.endsWith('.html') ? '.html' : '.txt'}`;
    writeFileSync(join(output, target), data);
    return { ...extra, name, path: target, source, sha256 };
  }
  function supplement(item, scope) {
    const { files, ...metadata } = item;
    return {
      ...metadata,
      scope,
      files: files.map((f) => file(join(reviewedRoot, f.path), f.source, f.name, f)),
    };
  }
  function add(item) {
    if (!item.files.length)
      throw new Error(`No notice text for ${item.scope}: ${item.name} ${item.version}`);
    item.files = [...new Map(item.files.map((f) => [f.sha256, f])).values()];
    components.push(item);
  }
  return { components, file, supplement, add };
}

// The runtime npm closure, which includes the bundled JS, fonts, and the Core worker and WASM,
// then the reviewed Core graph and the retained shell integration.
export function collectWebInterface({ file, supplement, add }) {
  const seen = new Set();
  function npm(directory) {
    directory = realpathSync(directory);
    if (seen.has(directory)) return;
    seen.add(directory);
    const pkg = json(join(directory, 'package.json'));
    if (!pkg.name.startsWith('@kino/')) {
      let files = noticeFiles(directory).map((p) =>
        file(p, `npm:${pkg.name}@${pkg.version}/${relative(directory, p)}`),
      );
      if (pkg.name === '@stremio/stremio-core-web')
        files = supplement(
          reviewed.core.find((p) => p.name === 'stremio-core-web'),
          'Core WASM',
        ).files;
      add({
        name: pkg.name,
        version: pkg.version,
        license: pkg.license,
        repository: typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository,
        scope: 'Web interface',
        files,
      });
    }
    const require = createRequire(join(directory, 'package.json'));
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const manifest = require.resolve
        .paths(name)
        .map((path) => join(path, name, 'package.json'))
        .find(existsSync);
      if (!manifest) throw new Error(`Cannot locate installed package ${name} from ${pkg.name}`);
      npm(dirname(manifest));
    }
  }
  npm(join(root, 'apps/desktop'));
  for (const item of reviewed.core)
    add(
      supplement(item, item.name === 'stremio-shell' ? 'Retained shell integration' : 'Core WASM'),
    );
}

// The engine's normal dependency graph as Cargo selects it for one target, with the reviewed
// supplements for crates that publish no notice, then the native code crates compile in from
// outside Cargo.
export function collectEngineCrates({ file, supplement, add }, target, cargo = 'cargo') {
  const manifest = join(root, 'apps/stream-engine/Cargo.toml');
  const cargoArgs = ['--offline', '--locked', '--manifest-path', manifest];
  const tree = run(cargo, [
    'tree',
    ...cargoArgs,
    '--target',
    target,
    '-e',
    'normal',
    '--prefix',
    'none',
    '--format',
    '{p}',
  ]);
  const selected = new Set([...tree.matchAll(/^(\S+) v(\S+)/gm)].map((m) => `${m[1]}@${m[2]}`));
  const metadata = JSON.parse(
    run(cargo, ['metadata', ...cargoArgs, '--format-version', '1', '--filter-platform', target]),
  );
  for (const pkg of metadata.packages) {
    if (!selected.has(`${pkg.name}@${pkg.version}`)) continue;
    const directory = dirname(pkg.manifest_path);
    const extra = reviewed.engine.filter((p) => p.name === pkg.name && p.version === pkg.version);
    const files = noticeFiles(directory).map((p) =>
      file(
        p,
        pkg.source?.startsWith('registry+')
          ? `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate#${pkg.name}-${pkg.version}/${relative(directory, p)}`
          : `${pkg.repository ?? extra[0]?.repository ?? 'Kino source'}#${relative(directory, p)}`,
      ),
    );
    for (const item of extra) files.push(...supplement(item, 'Streaming engine').files);
    add({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? extra[0]?.license,
      repository: pkg.repository ?? extra[0]?.repository,
      scope: 'Streaming engine',
      notes: extra
        .map((p) => p.notes)
        .filter(Boolean)
        .join(' '),
      files: [...new Map(files.map((f) => [f.sha256, f])).values()],
    });
  }
  // Reviews for names Cargo does not know describe native code a crate compiles in, and count
  // only while that crate is selected. A crate this target does not select is not embedded code.
  const crateNames = new Set(
    [
      ...readFileSync(join(root, 'apps/stream-engine/Cargo.lock'), 'utf8').matchAll(
        /^name = "([^"]+)"/gm,
      ),
    ].map((m) => m[1]),
  );
  const selectedNames = new Set([...selected].map((id) => id.split('@')[0]));
  for (const item of reviewed.engine.filter(
    (p) =>
      !crateNames.has(p.name) && (!embeddedBy[p.name] || selectedNames.has(embeddedBy[p.name])),
  ))
    add(supplement(item, 'Streaming engine, embedded native code'));
}

export const embeddedBy = { UnRAR: 'async-rar', '7-Zip': 'async-sevenz' };

// The Rust runtime review matching the one compiler revision a built engine embeds.
export function engineRuntime(binary, reviews = reviewed.rust) {
  const revisions = new Set(
    [
      ...readFileSync(binary)
        .toString('latin1')
        .matchAll(/\/rustc\/([a-f0-9]{40})/g),
    ].map((m) => m[1]),
  );
  const found = reviews.find((p) => revisions.size === 1 && revisions.has(p.revision));
  if (!found)
    throw new Error(
      `Review the Rust runtime embedded in the engine: ${[...revisions].join(', ') || 'unknown compiler revision'}`,
    );
  return found;
}

export function generateLicenseNotices(app, binaries) {
  verifyReviewedNotices();
  const output = join(app, 'Contents/Resources/licenses');
  const collector = noticeCollector(output);
  const { components, file, supplement, add } = collector;
  add({
    name: 'Kino',
    version: run('/usr/libexec/PlistBuddy', [
      '-c',
      'Print :CFBundleShortVersionString',
      join(app, 'Contents/Info.plist'),
    ]).trim(),
    scope: 'Application',
    license: 'GPL-3.0-only',
    repository: 'https://github.com/chriscorbell/kino',
    binaries: binaries
      .filter((p) =>
        ['Contents/MacOS/Kino', 'Contents/MacOS/kino-stream-engine'].includes(relative(app, p)),
      )
      .map((p) => relative(app, p)),
    files: kinoSources.map((p) => file(join(root, p), `Kino source: ${p}`)),
  });
  collectWebInterface(collector);

  const engine = join(app, 'Contents/MacOS/kino-stream-engine');
  if (existsSync(engine)) {
    collectEngineCrates(collector, 'aarch64-apple-darwin');
    add(supplement(engineRuntime(engine), 'Streaming engine'));
  }

  // Match UUIDs, which survive install-name changes and signing, to the active
  // Homebrew keg. Basenames alone cannot distinguish libraries from two kegs.
  const prefix = run('brew', ['--prefix']).trim();
  const byName = new Map();
  const roots = new Set(
    readdirSync(join(prefix, 'opt')).map((p) => realpathSync(join(prefix, 'opt', p))),
  );
  const wanted = new Set(binaries.map((p) => basename(p)));
  for (const keg of roots) {
    for (const path of ['lib', 'Frameworks', 'share/qt/plugins', 'share/qt/qml'].flatMap((p) =>
      walk(join(keg, p)),
    )) {
      if (!wanted.has(basename(path))) continue;
      const list = byName.get(basename(path)) ?? [];
      const original = realpathSync(path);
      const [formula, version] = relative(join(prefix, 'Cellar'), original).split('/');
      if (formula === '..') throw new Error(`Homebrew source lies outside its Cellar: ${original}`);
      list.push({ path: original, keg: join(prefix, 'Cellar', formula, version) });
      byName.set(basename(path), list);
    }
  }
  const uuid = (path) => {
    try {
      return execFileSync('dwarfdump', ['--uuid', path], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).match(/UUID: ([A-F0-9-]+)/i)?.[1];
    } catch {
      return null;
    }
  };
  const native = new Map();
  for (const binary of binaries) {
    const path = relative(app, binary);
    if (components[0].binaries.includes(path)) continue;
    const id = uuid(binary);
    if (!id) throw new Error(`No Mach-O UUID: ${path}`);
    const matches = (byName.get(basename(binary)) ?? []).filter(
      (candidate) => uuid(candidate.path) === id,
    );
    const kegs = [...new Set(matches.map((c) => c.keg))];
    if (kegs.length !== 1)
      throw new Error(
        `Cannot identify shipped binary ${path}: ${kegs.join(', ') || 'no matching Homebrew UUID'}`,
      );
    const keg = kegs[0];
    const entry = native.get(keg) ?? { binaries: [], origins: [] };
    entry.binaries.push(path);
    entry.origins.push({ binary: path, uuid: id, sourcePath: relative(keg, matches[0].path) });
    native.set(keg, entry);
  }
  if (existsSync(join(app, 'Contents/MacOS/kino-stream-engine'))) {
    const boost = realpathSync(join(prefix, 'opt/boost'));
    if (!native.has(boost))
      native.set(boost, {
        binaries: [],
        origins: [],
        notes: 'Boost headers are compiled into the streaming engine libtorrent bindings.',
      });
  }
  for (const [keg, inventory] of native) {
    const name = basename(dirname(keg));
    const version = basename(keg);
    const sbomPath = join(keg, 'sbom.spdx.json');
    const sbom = json(sbomPath);
    const source =
      sbom.packages.find((p) => p.SPDXID.startsWith('SPDXRef-Archive-')) ?? sbom.packages[0];
    const files = [
      ...noticeFiles(keg, false),
      ...noticeFiles(join(keg, 'LICENSES')),
      ...noticeFiles(join(keg, 'share/doc')),
    ].map((p) => file(p, `${source.downloadLocation}#${relative(keg, p)}`));
    const group = name.startsWith('qt') ? reviewed.qt : reviewed.homebrew;
    const extra = group.find(
      (p) => p.name === name && [version, source.versionInfo].includes(p.version),
    );
    if ((name.startsWith('qt') || reviewed.homebrew.some((p) => p.name === name)) && !extra)
      throw new Error(`Review full notice supplements for ${name} ${source.versionInfo}`);
    if (extra) files.push(...supplement(extra, 'Native libraries').files);
    if (!files.length) throw new Error(`No license files in ${name} ${version}`);
    files.push(
      file(sbomPath, 'Homebrew installed formula source and license metadata', 'sbom.spdx.json'),
    );
    add({
      name,
      version,
      license: source.licenseConcluded,
      repository: source.downloadLocation,
      scope: 'Native libraries',
      ...inventory,
      notes: [
        'The formula license declaration below does not replace the separate terms for embedded components in these notice files.',
        inventory.notes,
        extra?.notes,
      ]
        .filter(Boolean)
        .join(' '),
      files,
    });
  }
  components.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
  const manifest = {
    schemaVersion: 1,
    scope:
      'Installed npm runtime closure; selected Rust dependency graph; every shipped Mach-O binary. Qt and Rust standard-library attributions include optional and platform-specific components.',
    components,
  };
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(output, 'index.html'), render(manifest));
  return verifyLicenseBundle(app, binaries);
}

export function verifyLicenseBundle(app, binaries) {
  const output = join(app, 'Contents/Resources/licenses');
  const manifest = json(join(output, 'manifest.json'));
  const packagedWasm = walk(join(app, 'Contents/Resources')).filter((p) => p.endsWith('.wasm'));
  if (!packagedWasm.some((p) => hash(readFileSync(p)) === reviewed.coreProvenance.wasm.sha256))
    throw new Error('The staged Core WASM does not match its reviewed notices.');
  const covered = new Set(manifest.components.flatMap((p) => p.binaries ?? []));
  for (const binary of binaries)
    if (!covered.has(relative(app, binary)))
      throw new Error(`No notice inventory for ${relative(app, binary)}`);
  for (const item of manifest.components) {
    if (!item.files.length) throw new Error(`Empty notices: ${item.name}`);
    for (const f of item.files) {
      if (
        !/^texts\/[a-f0-9]{64}\.(txt|html)$/.test(f.path) ||
        hash(readFileSync(join(output, f.path))) !== f.sha256
      )
        throw new Error(`Invalid packaged notice: ${item.name}/${f.path}`);
    }
  }
  for (const name of [
    'Kino',
    'react',
    '@stremio/stremio-core-web',
    'stremio-shell',
    'qtbase',
    'qtwebengine',
    'mpv',
  ])
    if (!manifest.components.some((p) => p.name === name))
      throw new Error(`Required notices missing: ${name}`);
  if (!readFileSync(join(output, 'index.html'), 'utf8').includes('manifest.json'))
    throw new Error('Notice index missing');
  console.log(
    `Verified notices for ${manifest.components.length} components and ${covered.size} shipped binaries.`,
  );
  return manifest;
}

// With inline, the page carries every text itself. A sandboxed app hands a browser a single
// file through the desktop portal, so links to the texts beside it would not resolve.
export function render(manifest, inline) {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const sections = [...new Set(manifest.components.map((p) => p.scope))];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kino licenses and notices</title>
<style>*{box-sizing:border-box}html{color-scheme:dark;background:#16191b;color:#e9e6df;font:16px/1.6 system-ui,sans-serif}body{max-width:960px;margin:auto;padding:48px 24px}h1{font-size:36px;line-height:1.2;font-weight:600}h2{margin-top:48px;font-size:23px}h3{margin:0;font-size:17px;font-weight:550}p{color:#b9b8b3}a{color:#b1ccce;text-underline-offset:3px}nav{display:flex;gap:12px 24px;flex-wrap:wrap;margin:28px 0}article{border-top:1px solid #34383a;padding:20px 0}article p{margin:4px 0}ul{padding-left:24px}input{width:100%;padding:13px 16px;border:1px solid #555c5e;border-radius:6px;background:#202527;color:inherit;font:inherit}a:focus-visible,input:focus-visible{outline:2px solid #b1ccce;outline-offset:4px}[hidden]{display:none}${inline ? 'figure{margin:0;border-top:1px solid #34383a;padding:20px 0}figcaption{font-weight:550}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace;color:#cfccc5}' : ''}</style>
<body><h1>Licenses and notices</h1><p>Kino and its bundled dependencies. Full upstream texts and retained provenance are available below, without an internet connection.</p><p>${escape(manifest.scope)}</p>${inline ? '' : '<a href="manifest.json">Read the component inventory and file checksums</a>'}<nav>${sections.map((s, i) => `<a href="#section-${i}">${escape(s)}</a>`).join('')}</nav><label for="search">Find a component</label><input type="search" id="search" placeholder="Name or license" autocomplete="off"><p id="count" role="status">${manifest.components.length} components</p>
${sections
  .map(
    (s, i) =>
      `<section id="section-${i}"><h2>${escape(s)}</h2>${manifest.components
        .filter((p) => p.scope === s)
        .map(
          (p) =>
            `<article data-search="${escape(`${p.name} ${p.version} ${p.license}`.toLowerCase())}"><h3>${escape(p.name)} <span>${escape(p.version)}</span></h3><p>Declared license: ${escape(p.license || 'Terms in the original notice files')}</p>${p.notes ? `<p>${escape(p.notes)}</p>` : ''}<ul>${p.files.map((f) => `<li><a href="${inline ? `#text-${f.sha256}` : f.path}">${escape(f.name)}</a>${f.kind ? ` (${escape(f.kind)})` : ''}</li>`).join('')}</ul></article>`,
        )
        .join('')}</section>`,
  )
  .join('')}${
    inline
      ? `<div id="texts"><h2>License texts</h2>${[
          ...new Map(
            manifest.components.flatMap((p) => p.files).map((f) => [f.sha256, f]),
          ).values(),
        ]
          .map(
            (f) =>
              `<figure id="text-${f.sha256}"><figcaption>${escape(f.name)}</figcaption><pre>${escape(readFileSync(join(inline, f.path), 'utf8'))}</pre></figure>`,
          )
          .join('')}</div>`
      : ''
  }
<script>const input=document.querySelector('#search');const items=[...document.querySelectorAll('article')];input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();let count=0;for(const item of items){item.hidden=!item.dataset.search.includes(query);if(!item.hidden)count++}for(const section of document.querySelectorAll('section'))section.hidden=![...section.querySelectorAll('article')].some(item=>!item.hidden);document.querySelector('#count').textContent=count+' component'+(count===1?'':'s')});</script></body></html>`;
}
