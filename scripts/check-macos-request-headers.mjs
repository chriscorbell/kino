#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
assert.ok(existsSync(binary), 'Build the native app first.');
const root = mkdtempSync(join(tmpdir(), 'kino-header-check-'));
const secret = `kino-header-${randomBytes(12).toString('hex')}`;
const headers = {
  Authorization: `Bearer ${secret}`,
  Cookie: `session=${secret}`,
  Referer: 'https://required.invalid/',
  'X-Kino-Probe': `${secret},literal\\backslash`,
  'X-Trailing': `${secret}\\`,
  'Z-Probe': 'after-trailing-backslash',
};
let child;
let server;
let untrustedServer;
let timeout;
try {
  const fixture = process.env.KINO_PLAYBACK_FIXTURE ?? join(root, 'fixture.mp4');
  if (!existsSync(fixture)) {
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24:duration=6',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      fixture,
    ]);
  }
  const bytes = readFileSync(fixture);
  const key = join(root, 'untrusted-key.pem');
  const cert = join(root, 'untrusted-cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=localhost',
      '-days',
      '1',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  let untrustedRequests = 0;
  untrustedServer = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (_request, response) => {
      untrustedRequests += 1;
      response.writeHead(403).end();
    },
  );
  untrustedServer.listen(0, '127.0.0.1');
  await once(untrustedServer, 'listening');
  const untrustedOrigin = `https://127.0.0.1:${untrustedServer.address().port}`;
  let report;
  let protectedRequests = 0;
  let plainRequests = 0;
  let subtitleRequests = 0;
  let leakedHeaders = false;
  let incorrectHeaders = false;
  const hasPrivateHeader = (request) =>
    Object.keys(headers).some((key) => request.headers[key.toLowerCase()] !== undefined);
  server = createServer((request, response) => {
    if (request.url === '/result') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        response.end();
        report(JSON.parse(body));
      });
      return;
    }
    if (request.url === '/subtitle.srt') {
      subtitleRequests += 1;
      leakedHeaders ||= hasPrivateHeader(request);
      response.end('1\n00:00:00,000 --> 00:00:05,000\nSynthetic subtitle\n');
      return;
    }
    if (request.url === '/protected.mp4') {
      protectedRequests += 1;
      if (
        !Object.entries(headers).every(
          ([key, value]) => request.headers[key.toLowerCase()] === value,
        )
      ) {
        incorrectHeaders = true;
        response.writeHead(403).end();
        return;
      }
    } else if (request.url === '/plain.mp4') {
      plainRequests += 1;
      leakedHeaders ||= hasPrivateHeader(request);
    } else {
      response.writeHead(404).end();
      return;
    }
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}),
    });
    response.end(bytes.subarray(start, end + 1));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const document = join(root, 'check.html');
  writeFileSync(
    document,
    `<!doctype html><meta charset="utf-8"><title>Kino header check</title>
<style>body{background:#09090a;color:#f4f4f5;font:16px sans-serif;padding:40px}</style>
<p>Checking native media requests.</p><script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
const origin = ${JSON.stringify(origin)};
const untrustedOrigin = ${JSON.stringify(untrustedOrigin)};
const headers = ${JSON.stringify(headers)};
function finish(value) { fetch(origin + '/result', {method:'POST',mode:'no-cors',body:JSON.stringify(value)}); }
new QWebChannel(qt.webChannelTransport, function(channel) {
  const native = channel.objects.kinoNative;
  let stage = 'protected', hardware = false, reported = false;
  native.playerEvent.connect(function(name, payload) {
    if (reported) return;
    if (name === 'hardwareDecoding') hardware = payload.active;
    if (name === 'error') {
      if (stage === 'tls') {
        stage = 'invalid';
        native.load(origin + '/protected.mp4', false, {'X-Bad': headers.Authorization + '\\r\\nInjected: value'});
        return;
      }
      reported = true;
      finish({ok:stage === 'invalid' && payload.code === 'invalid-request-headers', stage, code:payload.code});
    } else if (name === 'time' && payload.milliseconds >= 1000 && hardware) {
      if (stage === 'protected') {
        stage = 'subtitle';
        native.addSubtitles(origin + '/subtitle.srt', 'Synthetic subtitle', 'en');
      } else if (stage === 'plain') {
        stage = 'tls';
        native.load(untrustedOrigin + '/protected.mp4', false, headers);
      }
    } else if (name === 'subtitleTracks' && stage === 'subtitle' && payload.items.some(item => item.external)) {
      stage = 'plain'; hardware = false;
      native.load(origin + '/plain.mp4', false, {});
    }
  });
  native.load(origin + '/protected.mp4', false, headers);
});
</script>`,
  );
  const verdict = new Promise((resolveReport, reject) => {
    report = resolveReport;
    timeout = setTimeout(() => reject(new Error('Native header probe timed out.')), 20000);
  });
  child = spawn(binary, [], {
    env: { ...process.env, KINO_UI_URL: document },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics += data;
  });
  const result = await verdict;
  assert.ok(result.ok, `Native header probe failed at ${result.stage}: ${result.code}`);
  assert.ok(protectedRequests > 0 && plainRequests > 0 && subtitleRequests > 0);
  assert.equal(incorrectHeaders, false, 'The protected source must receive exact header values.');
  assert.equal(leakedHeaders, false, 'Subtitles and later media must not receive source headers.');
  assert.equal(untrustedRequests, 0, 'An untrusted TLS server must not receive request headers.');
  assert.equal(
    diagnostics.includes(secret),
    false,
    'Request credentials must not enter diagnostics.',
  );
  console.log(
    'WebChannel -> libmpv header playback, subtitle isolation, next-source reset, TLS verification, and injection rejection passed.',
  );
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(force);
  }
  server?.closeAllConnections();
  server?.close();
  untrustedServer?.closeAllConnections();
  untrustedServer?.close();
  rmSync(root, { recursive: true, force: true });
}
