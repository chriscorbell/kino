#!/usr/bin/env node

// Probe a fresh engine through a blocking HTTP proxy. Tracker-list refreshes
// are data fetches; release downloads and executable tools are forbidden.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(
  process.env.KINO_ENGINE_BINARY ?? 'build/engine-target/release/kino-stream-engine',
);
assert.ok(existsSync(binary), 'Build the native helper with pnpm engine:build first.');
const root = mkdtempSync(join(tmpdir(), 'kino-profile-check-'));
const requests = [];
let seedServer;

function withHost(url, host) {
  return new Promise((resolveStatus, reject) => {
    const request = httpRequest(url, { headers: { Host: host } }, (response) => {
      response.resume();
      resolveStatus(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
}

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
const proxy = createServer((socket) => {
  socket.once('data', (data) => {
    requests.push(data.toString().split('\r\n')[0]);
    socket.end('HTTP/1.1 502 Blocked by Kino test\r\nContent-Length: 0\r\n\r\n');
  });
  socket.on('error', () => {});
});
proxy.listen(0, '127.0.0.1');
await once(proxy, 'listening');
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
const env = {
  ...process.env,
  PATH: root,
  KINO_ENGINE_CACHE_DIR: root,
  KINO_ENGINE_PORT: '0',
  HTTP_PROXY: proxyUrl,
  HTTPS_PROXY: proxyUrl,
  ALL_PROXY: proxyUrl,
  http_proxy: proxyUrl,
  https_proxy: proxyUrl,
  all_proxy: proxyUrl,
  NO_PROXY: '127.0.0.1,localhost',
  no_proxy: '127.0.0.1,localhost',
};
delete env.STREMIO_YTDLP_PATH;
const child = spawn(binary, [], {
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
let output = '';
let diagnostics = '';
child.stderr.on('data', (data) => {
  diagnostics += data;
});
const timeout = setTimeout(
  () => child.kill('SIGKILL'),
  process.env.KINO_ENGINE_PLAYER_BINARY ? 60000 : 20000,
);
try {
  const address = await new Promise((resolveAddress, reject) => {
    child.on('error', reject);
    child.on('exit', () => reject(new Error('Engine exited before readiness.')));
    child.stdout.on('data', (data) => {
      output += data;
      const match = output.match(
        /^KINO_ENGINE_READY (http:\/\/127\.0\.0\.1:\d+\/kino\/[a-f0-9]{64})$/m,
      );
      if (match) resolveAddress(match[1]);
    });
  });
  const origin = new URL(address).origin;
  const token = new URL(address).pathname.split('/').at(-1);
  const uiOrigin = env.KINO_ENGINE_UI_ORIGIN ?? 'null';
  assert.equal((await fetch(`${origin}/settings`)).status, 401);
  assert.equal((await fetch(`${origin}/kino/${'0'.repeat(64)}/settings`)).status, 401);
  assert.equal(
    (await fetch(`${address}/settings`, { headers: { Origin: 'https://untrusted.example' } }))
      .status,
    403,
  );
  assert.equal(await withHost(`${address}/settings`, 'untrusted.example'), 403);
  const allowed = await fetch(`${address}/settings`, { headers: { Origin: uiOrigin } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), uiOrigin);
  const initialSettings = await allowed.json();
  const forbiddenWrite = await fetch(`${address}/settings`, {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ seedingEnabled: !initialSettings.values.seedingEnabled }),
  });
  assert.equal(forbiddenWrite.status, 403);
  assert.equal(
    (await (await fetch(`${address}/settings`)).json()).values.seedingEnabled,
    initialSettings.values.seedingEnabled,
    'A foreign-origin write must not change settings.',
  );
  const preflight = await fetch(`${address}/settings`, {
    method: 'OPTIONS',
    headers: {
      Origin: uiOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), uiOrigin);
  assert.ok(preflight.headers.get('Access-Control-Allow-Methods')?.includes('POST'));
  const forbiddenPreflight = await fetch(`${address}/settings`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(forbiddenPreflight.status, 403);
  assert.equal(forbiddenPreflight.headers.get('Access-Control-Allow-Origin'), null);
  for (const path of [
    'removeAll',
    'list',
    'proxy/test',
    'ftp/test',
    'update/check',
    'diagnostics/logs',
    'rar/test',
    'zip/test',
    'nzb/test',
    'anything/downloader',
    'hlsv2/probe',
  ]) {
    assert.equal(
      (await fetch(`${address}/${path}`)).status,
      404,
      `Unused route ${path} must be disabled.`,
    );
  }
  const rejectedSettings = await fetch(`${address}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ autoUpdateEnabled: true }),
  });
  assert.equal(rejectedSettings.status, 422, 'Unsupported engine settings must be rejected.');
  console.log('Authentication, exact Host/Origin, CORS, and disabled routes passed.');
  assert.equal((await fetch(`${address}/heartbeat`)).status, 200);
  const youtube = await fetch(`${address}/yt/abcdefghijk.json`);
  await youtube.arrayBuffer();
  const missing = await fetch(
    `${address}/probe/missing/route/not/found?token=KINO_PROBE_QUERY_VALUE&stream=https%3A%2F%2Ftest.invalid%2FKINO_PROBE_URL_VALUE`,
    {
      headers: {
        Authorization: 'Bearer KINO_PROBE_AUTH_VALUE',
        'X-Custom-Credential': 'KINO_PROBE_HEADER_VALUE',
        Cookie: 'session=KINO_PROBE_COOKIE_VALUE',
        'Content-Type': 'application/x-KINO_PROBE_CONTENT_VALUE',
        Range: 'bytes=0-KINO_PROBE_RANGE_VALUE',
      },
    },
  );
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
  const results = {
    youtubeStatus: youtube.status,
    outboundHttp: requests,
    toolsDirectory: existsSync(join(root, 'tools')),
  };
  console.log(JSON.stringify(results));
  const unexpectedRequests = requests.filter(
    (request) => !/^CONNECT raw\.githubusercontent\.com:443 HTTP\/1\.1$/.test(request),
  );
  assert.deepEqual(unexpectedRequests, [], 'Only upstream tracker-list HTTP requests are allowed.');
  assert.equal(youtube.status, 404, 'YouTube resolution must be unavailable.');
  assert.equal(results.toolsDirectory, false, 'A clean start must not provision executable tools.');
  assert.ok(
    diagnostics.includes('unhandled request'),
    'Engine failures must reach its diagnostic pipe.',
  );
  assert.ok(diagnostics.includes('status=404'), 'Diagnostics must preserve the failure status.');
  assert.ok(
    !diagnostics.includes('KINO_PROBE_'),
    'Credentials must be removed before stderr output.',
  );
  assert.ok(!diagnostics.includes(token), 'The session capability must not appear in diagnostics.');
  function checkFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) checkFiles(path);
      else {
        assert.equal(statSync(path).mode & 0o111, 0, `Engine created an executable: ${entry.name}`);
        assert.ok(
          !/\.(log|jsonl)$/.test(entry.name),
          'The helper must not create separate log files.',
        );
        assert.ok(
          !readFileSync(path).includes(Buffer.from('KINO_PROBE_')),
          'Credentials must not reach engine files.',
        );
      }
    }
  }
  checkFiles(root);

  // A private torrent with a local web seed exercises byte ranges without
  // relying on a public swarm or fetching third-party media.
  const media = process.env.KINO_ENGINE_MEDIA_FIXTURE
    ? readFileSync(process.env.KINO_ENGINE_MEDIA_FIXTURE)
    : Buffer.from(Array.from({ length: 32768 }, (_, index) => index % 251));
  seedServer = createHttpServer((request, response) => {
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    response.writeHead(range ? 206 : 200, {
      'Content-Length': end - start + 1,
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : media.subarray(start, end + 1));
  });
  seedServer.listen(0, '127.0.0.1');
  await once(seedServer, 'listening');
  const pieces = [];
  for (let offset = 0; offset < media.length; offset += 16384) {
    pieces.push(
      createHash('sha1')
        .update(media.subarray(offset, offset + 16384))
        .digest(),
    );
  }
  const infoValue = {
    length: media.length,
    name: 'fixture.bin',
    'piece length': 16384,
    pieces: Buffer.concat(pieces),
    private: 1,
  };
  const info = bencode(infoValue);
  const infoHash = createHash('sha1').update(info).digest('hex');
  const torrent = bencode({
    info: infoValue,
    'url-list': `http://127.0.0.1:${seedServer.address().port}/fixture.bin`,
  });
  const created = await fetch(`${address}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent: torrent.toString('hex') }),
  });
  assert.equal(created.status, 200);
  const stats = await created.json();
  assert.equal(stats.infoHash, infoHash, 'Torrent creation must still return the supplied media.');
  const mediaUrl = `${address}/${infoHash}/0`;
  assert.equal((await fetch(`${origin}/${infoHash}/0`)).status, 401);
  const range = await fetch(mediaUrl, {
    headers: { Range: 'bytes=1024-2047' },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(range.status, 206, 'Native-style authenticated range read must succeed.');
  assert.equal(range.headers.get('Content-Range'), `bytes 1024-2047/${media.length}`);
  assert.ok(
    Buffer.from(await range.arrayBuffer()).equals(media.subarray(1024, 2048)),
    'Range bytes must match the source.',
  );
  const head = await fetch(mediaUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('Content-Length')), media.length);
  assert.equal(
    (await fetch(`${address}/${infoHash}/create`)).status,
    405,
    'Torrent creation must require POST.',
  );
  assert.equal(
    (await fetch(`${address}/${infoHash}/remove`)).status,
    404,
    'Legacy state-changing GET must be disabled.',
  );
  if (process.env.KINO_ENGINE_PLAYER_BINARY) {
    assert.ok(
      process.env.KINO_ENGINE_MEDIA_FIXTURE,
      'Native playback requires a legal media fixture.',
    );
    const player = spawn(resolve(process.env.KINO_ENGINE_PLAYER_BINARY), [], {
      env: { ...process.env, KINO_ENGINE_PROBE: '', KINO_PLAYBACK_PROBE: mediaUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let verdictOutput = '';
    player.stdout.on('data', (data) => {
      verdictOutput += data;
    });
    player.stderr.resume();
    const playerTimeout = setTimeout(() => player.kill('SIGKILL'), 20000);
    try {
      await once(player, 'close');
      const line = verdictOutput.split('\n').find((line) => line.startsWith('KINO_PROBE_RESULT '));
      assert.ok(line, 'Native player must produce a playback verdict.');
      assert.equal(JSON.parse(line.slice('KINO_PROBE_RESULT '.length)).outcome, 'played');
      console.log('Native libmpv playback over the authenticated torrent URL passed.');
    } finally {
      clearTimeout(playerTimeout);
    }
  }
  assert.equal((await fetch(`${address}/${infoHash}`, { method: 'DELETE' })).status, 200);
  console.log('Private torrent creation, authenticated byte ranges, and removal passed.');
} finally {
  child.stdin.end();
  await exited;
  clearTimeout(timeout);
  proxy.close();
  seedServer?.closeAllConnections();
  seedServer?.close();
  rmSync(root, { recursive: true, force: true });
}
