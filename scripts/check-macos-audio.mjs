#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'kino-audio-'));
const media = join(root, 'two-languages.mkv');
const binary = resolve(process.env.KINO_APP_BINARY ?? 'build/macos/Kino.app/Contents/MacOS/Kino');
let report;
let child;
let timer;
const server = createServer((request, response) => {
  if (request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      report = JSON.parse(body);
      response.end();
    });
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><title>Audio track check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, async channel => {
  const native = channel.objects.kinoNative;
  const lifecycle = channel.objects.kinoLifecycle;
  lifecycle.closeRequested.connect(id => lifecycle.acknowledgeClose(id,true));
  let phase = 'preferred language';
  const selection = (language, action) => new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('track selection timed out')),10000);
    function event(name,payload) {
      if (name !== 'audioTracks' || !payload.items.some(track => track.selected && track.lang === language)) return;
      clearTimeout(timer);native.playerEvent.disconnect(event);resolve(payload.items);
    }
    native.playerEvent.connect(event);action();
  });
  let result;
  try {
    const tracks = await selection('spa', () => native.loadWithAudioLanguage(${JSON.stringify(media)},false,{},'spa'));
    if (tracks.length !== 2) throw new Error('expected two audio tracks');
    const english = tracks.find(track => track.lang === 'eng');
    if (!english) throw new Error('missing English track');
    phase = 'manual switch';
    await selection('eng', () => native.setAudioTrack(english.id));
    phase = 'preference after manual switch';
    await selection('spa', () => native.loadWithAudioLanguage(${JSON.stringify(media)},false,{},'spa'));
    phase = 'unavailable language fallback';
    await selection('eng', () => native.loadWithAudioLanguage(${JSON.stringify(media)},false,{},'jpn'));
    result = {ok:true};
  } catch { result = {ok:false,phase}; }
  native.stop();
  await fetch('/result',{method:'POST',body:JSON.stringify(result)});
  lifecycle.setReady(true);
});
</script>`);
});
try {
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=24:duration=8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=880:duration=8',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:0',
    'title=English',
    '-metadata:s:a:1',
    'language=spa',
    '-metadata:s:a:1',
    'title=Spanish',
    '-disposition:a:0',
    'default',
    '-disposition:a:1',
    '0',
    media,
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  child = spawn(binary, [], {
    env: {
      ...process.env,
      KINO_UI_URL: `http://127.0.0.1:${server.address().port}`,
      KINO_CLOSE_PROBE: 'window',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.resume();
  const result = await Promise.race([
    once(child, 'exit'),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Audio probe timed out.')), 45000);
    }),
  ]);
  assert.deepEqual(result, [0, null]);
  assert.equal(report?.ok, true, `Audio track check failed at ${report?.phase}.`);
  console.log(
    'Native playback preferred Spanish, switched to English, reset the manual choice for the next load, and fell back when Japanese was unavailable.',
  );
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  server.closeAllConnections();
  server.close();
  rmSync(root, { recursive: true, force: true });
}
