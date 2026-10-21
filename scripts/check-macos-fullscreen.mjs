import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';

const binary = process.env.KINO_APP_BINARY ?? resolve('build/macos/Kino.app/Contents/MacOS/Kino');
// Qt reports the requested state at once, before macOS has moved the window to or from its own
// Space, and macOS ignores a request made during that move. So each transition waits for the
// notification macOS sends when the move is done, which Qt logs under the category this probe
// enables. Other systems change the state without that move, and the new size is the end of it.
const COMPLETED = /NSWindowDid(?:Enter|Exit)FullScreenNotification/;
const spaces = process.platform === 'darwin';
const TRANSITION_MS = 10000;
let diagnostics = '';
let completed = 0;
const waiting = new Set();
let report;
const server = createServer((request, response) => {
  const settled = request.url.match(/^\/settled\/(\d+)$/);
  if (settled) {
    const wanted = Number(settled[1]);
    const waiter = {
      check() {
        if (spaces && completed < wanted) return;
        clearTimeout(waiter.timer);
        waiting.delete(waiter);
        response.end('settled');
      },
      timer: setTimeout(() => {
        waiting.delete(waiter);
        response.statusCode = 504;
        response.end(`macOS finished ${completed} of ${wanted} fullscreen transitions.`);
      }, TRANSITION_MS),
    };
    waiting.add(waiter);
    waiter.check();
    return;
  }
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
  const windowed = innerWidth;
  const resized = enabled => new Promise((resolve, reject) => {
    const width = enabled ? screen.width : windowed;
    const timer = setTimeout(() => reject(new Error(enabled
      ? 'The window did not fill the screen.'
      : 'The window did not return to its size.')), ${TRANSITION_MS});
    const check = () => {
      if (innerWidth !== width) return;
      clearTimeout(timer);
      removeEventListener('resize', check);
      resolve();
    };
    addEventListener('resize', check);
    check();
  });
  try {
    if (typeof native.fullscreen !== 'boolean' || !native.fullscreenChanged)
      throw new Error('Fullscreen property and change signal are required.');
    for (const [index, enabled] of [true, false, true, false].entries()) {
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
      await resized(enabled);
      const settled = await fetch('/settled/' + (index + 1));
      if (!settled.ok) throw new Error(await settled.text());
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
    env: {
      ...process.env,
      KINO_UI_URL: origin,
      KINO_CLOSE_PROBE: 'window',
      QT_LOGGING_RULES: 'qt.qpa.cocoa.notifications.debug=true',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let partial = '';
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-8000);
    const lines = (partial + data).split('\n');
    partial = lines.pop();
    completed += lines.filter((line) => COMPLETED.test(line)).length;
    for (const waiter of waiting) waiter.check();
  });
  const result = await Promise.race([
    once(child, 'exit'),
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Fullscreen probe timed out: ${diagnostics}`)),
        60000,
      );
    }),
  ]);
  assert.deepEqual(result, [0, null], `The native shell must close normally: ${diagnostics}`);
  assert.deepEqual(
    report,
    { initial: false, changes: [true, false, true, false] },
    `Native fullscreen transitions must complete: ${diagnostics}`,
  );
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
