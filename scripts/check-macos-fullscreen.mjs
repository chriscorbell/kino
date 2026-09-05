import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const binary = process.env.KINO_APP_BINARY ?? resolve('build/macos/Kino.app/Contents/MacOS/Kino');
let report;
const server = createServer((request, response) => {
  if (request.url === '/result') {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      report = JSON.parse(body);
      response.end('received');
    });
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><meta charset="utf-8"><title>Kino fullscreen check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, async channel => {
  const native = channel.objects.kinoNative, lifecycle = channel.objects.kinoLifecycle;
  lifecycle.closeRequested.connect(id => lifecycle.acknowledgeClose(id, true));
  const result = { initial: native.fullscreen, changes: [] };
  try {
    if (typeof native.fullscreen !== 'boolean' || !native.fullscreenChanged)
      throw new Error('Fullscreen property and change signal are required.');
    for (const enabled of [true, false, true, false]) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fullscreen state did not change.')), 5000);
        const changed = () => {
          if (native.fullscreen !== enabled) return;
          result.changes.push(native.fullscreen);
          clearTimeout(timer);
          native.fullscreenChanged.disconnect(changed);
          resolve();
        };
        native.fullscreenChanged.connect(changed);
        native.setFullscreen(enabled);
      });
      // Allow macOS to finish its window transition before reversing it.
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  } catch (error) { result.error = error.message; }
  await fetch('/result', { method: 'POST', body: JSON.stringify(result) });
  lifecycle.setReady(true);
});
</script>`);
});
let child;
let timer;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  child = spawn(binary, [], {
    env: { ...process.env, KINO_UI_URL: origin, KINO_CLOSE_PROBE: 'window' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-8000);
  });
  const result = await Promise.race([
    once(child, 'exit'),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Fullscreen probe timed out: ${diagnostics}`)),
        30000,
      );
    }),
  ]);
  assert.deepEqual(result, [0, null], `The native shell must close normally: ${diagnostics}`);
  assert.deepEqual(report, { initial: false, changes: [true, false, true, false] });
  console.log('Native WebChannel reports actual fullscreen state through repeated entry and exit.');
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
