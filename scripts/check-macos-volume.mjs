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
  response.end(`<!doctype html><meta charset="utf-8"><title>Kino volume check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, async channel => {
  const native = channel.objects.kinoNative, lifecycle = channel.objects.kinoLifecycle;
  lifecycle.closeRequested.connect(id => lifecycle.acknowledgeClose(id, true));
  const result = { changes: [] };
  try {
    if (typeof native.setVolume !== 'function') throw new Error('Volume method is required.');
    for (const [requested, expected] of [[37.5, 37.5], [0, 0], [100, 100], [-20, 0], [200, 100]]) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Volume did not change.')), 5000);
        const changed = (name, payload) => {
          if (name !== 'volume' || payload.percent !== expected) return;
          result.changes.push(payload.percent);
          clearTimeout(timer);
          native.playerEvent.disconnect(changed);
          resolve();
        };
        native.playerEvent.connect(changed);
        native.setVolume(requested);
      });
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
      timer = setTimeout(() => reject(new Error(`Volume probe timed out: ${diagnostics}`)), 30000);
    }),
  ]);
  assert.deepEqual(result, [0, null], `The native shell must close normally: ${diagnostics}`);
  assert.deepEqual(report, { changes: [37.5, 0, 100, 0, 100] });
  console.log(
    'Native WebChannel sets and observes libmpv volume, including mute level and bounded values.',
  );
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
