#!/usr/bin/env node

// Probe a fresh engine through a blocking HTTP proxy. Tracker-list refreshes
// are data fetches; release downloads and executable tools are forbidden.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
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
const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
try {
  const address = await new Promise((resolveAddress, reject) => {
    child.on('error', reject);
    child.on('exit', () => reject(new Error('Engine exited before readiness.')));
    child.stdout.on('data', (data) => {
      output += data;
      const match = output.match(/^KINO_ENGINE_READY (http:\/\/127\.0\.0\.1:\d+)$/m);
      if (match) resolveAddress(match[1]);
    });
  });
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

  // Metadata-only private torrent with no trackers or public swarm traffic.
  const piece = Buffer.from('Kino probe');
  const info = Buffer.concat([
    Buffer.from('d6:lengthi10e4:name11:fixture.bin12:piece lengthi16384e6:pieces20:'),
    createHash('sha1').update(piece).digest(),
    Buffer.from('7:privatei1ee'),
  ]);
  const infoHash = createHash('sha1').update(info).digest('hex');
  const torrent = Buffer.concat([Buffer.from('d4:info'), info, Buffer.from('e')]);
  const created = await fetch(`${address}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ torrent: torrent.toString('hex') }),
  });
  assert.equal(created.status, 200);
  const stats = await created.json();
  assert.equal(stats.infoHash, infoHash, 'Torrent creation must still return the supplied media.');
  assert.equal((await fetch(`${address}/${infoHash}/remove`)).status, 200);
  console.log('Private torrent creation and removal passed.');
} finally {
  child.stdin.end();
  await exited;
  clearTimeout(timeout);
  proxy.close();
  rmSync(root, { recursive: true, force: true });
}
