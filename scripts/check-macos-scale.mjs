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
  response.end(`<!doctype html><meta charset="utf-8"><title>Kino scale check</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script><script>
new QWebChannel(qt.webChannelTransport, async channel => {
  const ui = channel.objects.kinoInterface, lifecycle = channel.objects.kinoLifecycle;
  lifecycle.closeRequested.connect(id => lifecycle.acknowledgeClose(id, true));
  const result = { scales: [], rejected: [] };
  try {
    for (const percent of [100, 125, 150, 175, 200, 100]) {
      if (!(await ui.setScale(percent))) throw new Error('Valid scale was rejected.');
      const started = Date.now();
      while (Math.abs(innerWidth - 1000 * 100 / percent) > 1 || Math.abs(innerHeight - 650 * 100 / percent) > 1) {
        if (Date.now() - started > 5000) throw new Error('Viewport did not resize for scale ' + percent + ': ' + innerWidth + 'x' + innerHeight);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      result.scales.push({ percent, width: innerWidth, height: innerHeight });
    }
    for (const percent of [0, 99, 101, 201, '150', null]) result.rejected.push(await ui.setScale(percent));
    result.reset = { width: innerWidth, height: innerHeight };
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
  child = spawn(binary, [], {
    env: {
      ...process.env,
      KINO_UI_URL: `http://127.0.0.1:${server.address().port}`,
      KINO_CLOSE_PROBE: 'window',
      KINO_SCALE_PROBE: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-8000);
  });
  const result = await Promise.race([
    once(child, 'exit'),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Scale probe timed out: ${diagnostics}`)), 30000);
    }),
  ]);
  assert.deepEqual(result, [0, null], diagnostics);
  assert.equal(report?.error, undefined, report?.error);
  assert.deepEqual(
    report?.scales.map((sample) => sample.percent),
    [100, 125, 150, 175, 200, 100],
  );
  assert.deepEqual(report?.rejected, [false, false, false, false, false, false]);
  assert.deepEqual(report?.reset, { width: 1000, height: 650 });
  console.log(
    'Native interface zoom resizes the minimum-window viewport through 100–200%, rejects unsupported values, and resets to 100%.',
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
