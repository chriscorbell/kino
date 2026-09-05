#!/usr/bin/env node
// Exercise clear and replay through production QML, WebChannel, helper, and mpv.
// All storage and synthetic media belong to this temporary test directory.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
const root = mkdtempSync(join(tmpdir(), 'kino-cache-clear-'));
const cache = join(root, 'cache');
const config = join(root, 'config');
let child;
let timeout;
let report;
let document = '';
let media;
const server = createServer((request, response) => {
  if (request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      response.end();
      try {
        report(JSON.parse(body));
      } catch {
        report({ ok: false, stage: 'invalid report' });
      }
    });
  } else if (request.url === '/fixture.mp4') {
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1;
    response.writeHead(range ? 206 : 200, {
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : media.subarray(start, end + 1));
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(document);
  }
});
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
try {
  const fixture = join(root, 'fixture.mp4');
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=24:duration=8',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    fixture,
  ]);
  media = readFileSync(fixture);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const pieces = [];
  for (let offset = 0; offset < media.length; offset += 16384)
    pieces.push(
      createHash('sha1')
        .update(media.subarray(offset, offset + 16384))
        .digest(),
    );
  const info = {
    length: media.length,
    name: 'fixture.mp4',
    'piece length': 16384,
    pieces: Buffer.concat(pieces),
    private: 1,
  };
  const hash = createHash('sha1').update(bencode(info)).digest('hex');
  const torrent = bencode({ info, 'url-list': `${origin}/fixture.mp4` }).toString('hex');
  mkdirSync(join(cache, 'streaming-engine'), { recursive: true });
  writeFileSync(join(cache, '.sentinel'), 'disposable');
  document = `<!doctype html><title>Cache clear and replay check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, async function(channel) {
  const native = channel.objects.kinoNative;
  const diagnostics = channel.objects.kinoDiagnostics;
  let stage = 'startup';
  const start = () => new Promise((resolve, reject) => {
    function changed(url, error) {
      if (!url && !error) return;
      native.streamingEngineChanged.disconnect(changed);
      error ? reject(new Error('engine')) : resolve(url);
    }
    native.streamingEngineChanged.connect(changed);
    native.startStreamingEngine();
  });
  const call = (object, name) => new Promise(resolve => object[name](resolve));
  const play = url => new Promise((resolve, reject) => {
    function event(name, payload) {
      if (name === 'error') { native.playerEvent.disconnect(event); reject(new Error('playback')); }
      if (name === 'time' && payload.milliseconds >= 400) { native.playerEvent.disconnect(event); resolve(); }
    }
    native.playerEvent.connect(event);
    native.load(url, false, {});
  });
  const create = async url => {
    const response = await fetch(url + '/create', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({torrent:${JSON.stringify(torrent)}})});
    if (!response.ok) throw new Error('create');
    return url + '/${hash}/0';
  };
  try {
    const first = await start();
    stage = 'save settings';
    const saved = await fetch(first + '/settings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seedingEnabled:false,btDownloadSpeedHardLimit:1048576})});
    if (!saved.ok) throw new Error('settings write');
    stage = 'first playback';
    await play(await create(first));
    stage = 'leave player';
    await call(native, 'stop');
    stage = 'clear cache';
    if (!await call(diagnostics, 'clearCache')) throw new Error('clear');
    stage = 'restart';
    const second = await start();
    if (first === second) throw new Error('stale capability');
    stage = 'read preserved settings';
    const settings = (await (await fetch(second + '/settings')).json()).values;
    if (settings.seedingEnabled !== false || settings.btDownloadSpeedHardLimit !== 1048576) throw new Error('settings');
    stage = 'replay';
    await play(await create(second));
    await call(native, 'stop');
    fetch('/result',{method:'POST',body:JSON.stringify({ok:true})});
  } catch { fetch('/result',{method:'POST',body:JSON.stringify({ok:false,stage})}); }
});
</script>`;
  const verdict = new Promise((resolveReport, reject) => {
    report = resolveReport;
    timeout = setTimeout(() => reject(new Error('Cache clear and replay timed out.')), 60000);
  });
  child = spawn(binary, [], {
    env: {
      ...process.env,
      KINO_UI_URL: origin,
      KINO_CACHE_DIR: cache,
      KINO_ENGINE_CACHE_DIR: join(cache, 'streaming-engine'),
      KINO_ENGINE_CONFIG_DIR: config,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.resume();
  const result = await verdict;
  assert.equal(result.ok, true, `Cache clear and replay failed at ${result.stage}.`);
  assert.equal(existsSync(join(cache, '.sentinel')), false);
  assert.ok(readdirSync(config).includes('settings.json'));
  console.log(
    'Torrent playback, leave, coordinated clear, settings preservation, fresh helper, and replay passed in one shell process.',
  );
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    const killTimeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(killTimeout);
  }
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
