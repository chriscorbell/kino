#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { adaptCoreState } from '../apps/desktop/src/core/adapters.ts';
import { torrentCreateRequest, torrentMediaUrl } from '../apps/desktop/src/player/torrent.ts';
import { initializeCore, resolveCoreStream } from './test-support/core-stream.mjs';

const fetchEngine = globalThis.fetch;
const binary = resolve(
  process.env.KINO_ENGINE_BINARY ?? 'build/engine-target/release/kino-stream-engine',
);
assert.ok(existsSync(binary), 'Build the native helper with pnpm engine:build first.');
const root = mkdtempSync(join(tmpdir(), 'kino-tracker-check-'));
const processes = [];
const servers = [];

function bencode(value) {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') value = Buffer.from(value);
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  return Buffer.concat([
    Buffer.from('d'),
    ...Object.keys(value)
      .sort()
      .flatMap((key) => [bencode(key), bencode(value[key])]),
    Buffer.from('e'),
  ]);
}

async function startProcess(command, args, env, pattern) {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  processes.push({ child, exit });
  child.stderr.resume();
  return new Promise((resolveReady, reject) => {
    let output = '';
    child.on('error', reject);
    child.on('exit', () => reject(new Error('Fixture process exited before readiness.')));
    child.stdout.on('data', (data) => {
      output += data;
      const match = output.match(pattern);
      if (match) resolveReady(match[1]);
    });
  });
}

const timeout = setTimeout(() => {
  for (const { child } of processes) child.kill('SIGKILL');
}, 30000);

try {
  const seeder = join(root, 'seeder');
  const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'libtorrent-rasterbar'], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/);
  if (process.platform === 'darwin') {
    flags.push(
      `-I${execFileSync('brew', ['--prefix', 'boost'], { encoding: 'utf8' }).trim()}/include`,
    );
  }
  execFileSync(
    process.env.CXX ?? 'c++',
    ['-std=c++17', 'scripts/test-support/torrent-seeder.cpp', '-o', seeder, ...flags],
    { stdio: 'inherit' },
  );
  const bytes = randomBytes(65536);
  const pieceLength = 16384;
  const info = {
    length: bytes.length,
    name: 'fixture.mp4',
    'piece length': pieceLength,
    pieces: Buffer.concat(
      Array.from({ length: bytes.length / pieceLength }, (_, index) =>
        createHash('sha1')
          .update(bytes.subarray(index * pieceLength, (index + 1) * pieceLength))
          .digest(),
      ),
    ),
  };
  const hash = createHash('sha1').update(bencode(info)).digest('hex');
  const torrentFile = join(root, 'fixture.torrent');
  writeFileSync(torrentFile, bencode({ info }));
  writeFileSync(join(root, 'fixture.mp4'), bytes);
  const seedPort = Number(
    await startProcess(seeder, [torrentFile, root], process.env, /^SEED_READY (\d+)$/m),
  );
  const peer = Buffer.from([127, 0, 0, 1, seedPort >> 8, seedPort & 255]);
  let announces = 0;
  const tracker = createServer((request, response) => {
    const encodedHash = request.url.match(/[?&]info_hash=([^&]+)/)?.[1] ?? '';
    const requestedHash = Buffer.from(
      encodedHash.replace(/%([0-9a-f]{2})/gi, (_, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
      'latin1',
    ).toString('hex');
    if (requestedHash !== hash) {
      response.writeHead(400).end();
      return;
    }
    announces += 1;
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(bencode({ interval: 1, peers: peer }));
  });
  tracker.listen(0, '127.0.0.1');
  servers.push(tracker);
  await once(tracker, 'listening');
  const trackerUrl = `http://127.0.0.1:${tracker.address().port}/announce`;

  // Block the helper's upstream tracker-list downloads. This random unpublished
  // torrent has no web seeds; only our tracker knows the seeder's address.
  // Do not set the private flag: libtorrent disables magnet metadata exchange
  // for private torrents. Discovery is disabled on the fixture seeder instead.
  const proxy = createServer((_request, response) => response.writeHead(502).end());
  proxy.on('connect', (_request, socket) => socket.end('HTTP/1.1 502 Blocked\r\n\r\n'));
  proxy.listen(0, '127.0.0.1');
  servers.push(proxy);
  await once(proxy, 'listening');
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const engineUrl = await startProcess(
    binary,
    [],
    {
      ...process.env,
      KINO_ENGINE_CACHE_DIR: join(root, 'engine'),
      KINO_ENGINE_CONFIG_DIR: join(root, 'config'),
      KINO_ENGINE_PORT: '0',
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
    /^KINO_ENGINE_READY (http:\/\/127\.0\.0\.1:\d+\/kino\/[a-f0-9]{64})$/m,
  );
  const core = await initializeCore();
  await resolveCoreStream(core, {
    infoHash: hash,
    fileIdx: 0,
    sources: [`tracker:${trackerUrl}`],
  });
  // The engine helpers take the adapted torrent source the Player screen holds,
  // so this reads the resolved stream the same way production does. Core emits
  // the add-on's peer sources as announce.
  const resolved = adaptCoreState('player', core.get_state('player')).stream;
  assert.equal(resolved?.type, 'Ready', 'Core must resolve the synthetic torrent.');
  const stream = resolved.content.source;
  assert.equal(stream.kind, 'torrent');
  assert.deepEqual(stream.sources, [`tracker:${trackerUrl}`]);
  const request = torrentCreateRequest(engineUrl, stream);
  assert.deepEqual(
    request.body.peerSearch.sources,
    [trackerUrl],
    'The add-on tracker must reach the helper in peerSearch.sources.',
  );
  const created = await fetchEngine(request.createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(created.status, 200);
  const stats = await created.json();
  assert.equal(stats.error, undefined, 'The helper must create the synthetic torrent.');
  const media = await fetchEngine(torrentMediaUrl(engineUrl, stream, 0), {
    headers: { Range: 'bytes=1024-2047' },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(media.status, 206);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes.subarray(1024, 2048));
  assert.ok(announces > 0, 'The supplied tracker must receive an announce from the real helper.');
  console.log(
    'Real Core -> engine -> tracker -> peer transfer returned the exact requested bytes.',
  );
} finally {
  clearTimeout(timeout);
  for (const { child, exit } of processes.reverse()) {
    child.stdin.end();
    const force = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exit;
    clearTimeout(force);
  }
  for (const server of servers) server.closeAllConnections();
  await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  rmSync(root, { recursive: true, force: true });
}
process.exit(0);
